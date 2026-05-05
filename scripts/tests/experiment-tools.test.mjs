import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  compareJobs,
  diagnoseJob,
  diffConfigRef,
  doctorBundle,
  syncLedger,
  verifyBundleAgainstJob,
} from "../experiment-tools.mjs";

async function makeBundle(tempRoot, options = {}) {
  const bundle = path.join(tempRoot, options.name ?? "bundle");
  await mkdir(path.join(bundle, "files"), { recursive: true });

  const configText = options.configText ?? "item_id_oov_threshold: 5\nitem_id_oov_buckets: 32\n";
  const runShText = options.runShText ?? "#!/usr/bin/env bash\necho train\n";
  await writeFile(path.join(bundle, "files", "code.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  await writeFile(path.join(bundle, "files", "config.yaml"), configText);
  await writeFile(path.join(bundle, "files", "run.sh"), runShText);
  await writeFile(
    path.join(bundle, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        job: options.job ?? { name: "v1 bucket 32", description: "阈值10 but config uses 5" },
        files: {
          codeZip: { basename: "code.zip", bytes: 4, preparedPath: "files/code.zip" },
          config: { basename: "config.yaml", bytes: Buffer.byteLength(configText), preparedPath: "files/config.yaml" },
          runSh: { basename: "run.sh", bytes: Buffer.byteLength(runShText), preparedPath: "files/run.sh" },
        },
        git: options.git ?? { available: true, dirty: true, head: "abc123", statusShort: " M config.yaml" },
      },
      null,
      2,
    ),
  );
  return bundle;
}

async function makeTaijiOutput(tempRoot) {
  const outputDir = path.join(tempRoot, "taiji-output");
  const jobId = "angel_job_a";
  const instanceId = "instance_a";
  const codeDir = path.join(outputDir, "code", jobId);
  const filesDir = path.join(codeDir, "files");
  const logDir = path.join(outputDir, "logs", jobId);
  await mkdir(filesDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  await writeFile(path.join(filesDir, "code.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  await writeFile(path.join(filesDir, "config.yaml"), "item_id_oov_threshold: 5\nitem_id_oov_buckets: 32\n");
  await writeFile(path.join(filesDir, "run.sh"), "#!/usr/bin/env bash\necho train\n");
  await writeFile(
    path.join(codeDir, "train-files.json"),
    JSON.stringify({
      saved: [
        { name: "code.zip", saved: true, relativePath: "code/angel_job_a/files/code.zip" },
        { name: "config.yaml", saved: true, relativePath: "code/angel_job_a/files/config.yaml" },
        { name: "run.sh", saved: true, relativePath: "code/angel_job_a/files/run.sh" },
      ],
    }),
  );
  await writeFile(
    path.join(logDir, `${instanceId}.txt`),
    "start\nResolved config: {'item_id_oov_threshold': 5, 'item_id_oov_buckets': 32}\nTraceback (most recent call last):\nValueError: example\n",
  );
  await writeFile(
    path.join(outputDir, "jobs-summary.csv"),
    [
      "jobId,jobInternalId,name,description,status,jzStatus,updateTime,syncMode,lastSeenAt,lastDeepFetchedAt,instances",
      'angel_job_a,56242,"v1 test 0.816577","bucket 32\nsecond line",SUCCEED,END,2026-05-05T01:00:00+08:00,deep,,,1',
      'angel_job_b,58244,"v2 test 0.815174","threshold 10",SUCCEED,END,2026-05-05T02:00:00+08:00,deep,,,1',
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(outputDir, "all-metrics-long.csv"),
    [
      "jobId,jobInternalId,jobName,instanceId,metric,chart,chartIndex,series,step,value",
      "angel_job_a,56242,v1,instance_a,AUC,valid,0,valid,1,0.86",
      "angel_job_a,56242,v1,instance_a,AUC,valid,0,valid,2,0.865",
      "angel_job_a,56242,v1,instance_a,AUC,valid_test_like,0,valid_test_like,2,0.864",
      "angel_job_a,56242,v1,instance_a,LogLoss,valid,0,valid,2,0.27",
      "angel_job_b,58244,v2,instance_b,AUC,valid,0,valid,1,0.861",
      "angel_job_b,58244,v2,instance_b,AUC,valid_test_like,0,valid_test_like,1,0.866",
      "",
    ].join("\n"),
  );
  return { outputDir, jobId, instanceId };
}

test("doctor validates a prepared submit bundle and records file hashes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-doctor-"));
  const bundle = await makeBundle(tempRoot);

  const report = await doctorBundle({ bundleDir: bundle });

  assert.equal(report.summary.status, "warn");
  assert.equal(report.files.length, 3);
  assert.equal(report.files.find((file) => file.name === "code.zip").sha256.length, 64);
  assert(report.findings.some((finding) => finding.code === "git_dirty"));
  assert(report.findings.some((finding) => finding.code === "description_threshold_mismatch"));
});

test("verify compares a bundle with downloaded platform trainFiles and resolved config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-verify-"));
  const bundle = await makeBundle(tempRoot, { job: { name: "v1", description: "bucket 32" }, git: { dirty: false } });
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await verifyBundleAgainstJob({ bundleDir: bundle, outputDir, jobInternalId: "56242" });

  assert.equal(report.summary.status, "pass");
  assert(report.files.every((file) => file.hashMatch));
  assert.equal(report.resolvedConfig.match, true);
});

test("compare jobs summarizes evidence without selecting a winner", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-compare-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await compareJobs({ outputDir, jobInternalIds: ["56242", "58244"] });

  assert.equal(report.jobs.length, 2);
  assert.equal(report.jobs[0].jobInternalId, "56242");
  assert.equal(report.jobs[0].metrics["AUC/valid"].bestValue, 0.865);
  assert.equal(report.jobs[0].explicitTestScore, 0.816577);
  assert.equal(report.decision, "not_provided");
});

test("config diff-ref compares local config against a downloaded job config", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-diff-ref-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);
  const currentConfig = path.join(tempRoot, "current.yaml");
  await writeFile(currentConfig, "item_id_oov_threshold: 10\nitem_id_oov_buckets: 32\n");

  const report = await diffConfigRef({ configPath: currentConfig, outputDir, jobInternalId: "56242" });

  assert.deepEqual(report.changed.map((item) => item.path), ["item_id_oov_threshold"]);
});

test("ledger sync writes a structured experiment ledger", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-ledger-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);
  const out = path.join(tempRoot, "ledger.json");

  const report = await syncLedger({ outputDir, out });
  const saved = JSON.parse(await readFile(out, "utf8"));

  assert.equal(report.experiments.length, 2);
  assert.equal(saved.experiments[0].jobInternalId, "56242");
  assert.equal(saved.experiments[0].explicitTestScore, 0.816577);
});

test("diagnose job extracts errors and resolved config from logs", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "taac2026-diagnose-"));
  const { outputDir } = await makeTaijiOutput(tempRoot);

  const report = await diagnoseJob({ outputDir, jobInternalId: "56242" });

  assert.equal(report.job.jobInternalId, "56242");
  assert.equal(report.errors.length, 2);
  assert.equal(report.resolvedConfigs.length, 1);
});
