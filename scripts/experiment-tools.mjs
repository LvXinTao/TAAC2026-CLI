#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { validateTrainFileDownload } from "./scrape-taiji.mjs";

const DEFAULT_OUT_ROOT = "taiji-output";

function usage() {
  return `Usage:
  taac2026 submit doctor --bundle <submit-bundle-dir> [--json] [--out <file>]
  taac2026 submit verify --bundle <submit-bundle-dir> --job-internal-id <id> [--output-dir taiji-output]
  taac2026 compare jobs <job-internal-id...> [--output-dir taiji-output] [--json]
  taac2026 config diff-ref --config <config.yaml> --job-internal-id <id> [--output-dir taiji-output]
  taac2026 ledger sync [--output-dir taiji-output] [--out <file>]
  taac2026 diagnose job --job-internal-id <id> [--output-dir taiji-output] [--json]`;
}

function parseArgs(argv) {
  const positional = [];
  const args = { positional };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      args[key] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return args;
}

function required(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function assertSafeRelativeOutputPath(outPath) {
  if (!path.isAbsolute(outPath) && String(outPath).split(/[\\/]+/).includes("..")) {
    throw new Error("Relative output paths must not contain '..'. Use an absolute path for custom locations outside taiji-output.");
  }
}

function resolveOutputPath(outPath, defaultSubdir) {
  assertSafeRelativeOutputPath(outPath);
  if (path.isAbsolute(outPath)) return outPath;
  if (outPath.split(/[\\/]/)[0] === DEFAULT_OUT_ROOT) return path.resolve(outPath);
  return path.resolve(DEFAULT_OUT_ROOT, defaultSubdir, outPath);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function csvParseRows(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\r") continue;
    if (ch === "\"" && inQuotes && text[i + 1] === "\"") {
      current += '"';
      i += 1;
    } else if (ch === "\"") {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if (ch === "\n" && !inQuotes) {
      row.push(current);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      current = "";
    } else {
      current += ch;
    }
  }
  row.push(current);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

async function readCsv(filePath) {
  if (!(await exists(filePath))) return [];
  const rows = csvParseRows(await readFile(filePath, "utf8"));
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((cells) => {
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
  });
}

function explicitTestScore(text) {
  const scores = [];
  for (const match of String(text ?? "").matchAll(/\btest\s*[:=]?\s*(0\.\d+)/gi)) {
    const prefix = String(text ?? "").slice(0, match.index).trim().split(/\s+/).at(-1)?.toLowerCase();
    if (prefix === "val") continue;
    scores.push(Number(match[1]));
  }
  return scores.length ? Math.max(...scores) : null;
}

async function loadJobRows(outputDir) {
  return readCsv(path.join(outputDir, "jobs-summary.csv"));
}

function matchJob(row, options) {
  if (options.jobInternalId && String(row.jobInternalId) === String(options.jobInternalId)) return true;
  if (options.jobId && String(row.jobId) === String(options.jobId)) return true;
  return false;
}

async function resolveJob(outputDir, options) {
  const rows = await loadJobRows(outputDir);
  const job = rows.find((row) => matchJob(row, options));
  if (!job) throw new Error(`Job not found in ${outputDir}: ${options.jobInternalId || options.jobId}`);
  return job;
}

function trainFileLocalPath(outputDir, jobId, fileName) {
  return path.join(outputDir, "code", jobId, "files", fileName);
}

function pythonishConfigToObject(text) {
  const normalized = text
    .replace(/:\s*\(([^()]*)\)/g, ": [$1]")
    .replaceAll("'", '"')
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
  return JSON.parse(normalized);
}

async function logFilesForJob(outputDir, jobId) {
  const dir = path.join(outputDir, "logs", jobId);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith(".txt")).map((name) => path.join(dir, name));
}

async function extractResolvedConfigs(outputDir, jobId) {
  const configs = [];
  for (const filePath of await logFilesForJob(outputDir, jobId)) {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    for (const line of lines) {
      const marker = "Resolved config: ";
      if (line.includes(marker)) {
        try {
          configs.push({
            file: filePath,
            config: pythonishConfigToObject(line.slice(line.indexOf(marker) + marker.length)),
          });
        } catch (error) {
          configs.push({ file: filePath, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return configs;
}

function flatten(value, prefix = "", out = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
}

function diffObjects(left, right, options = {}) {
  const a = flatten(left);
  const b = flatten(right);
  const added = [];
  const removed = [];
  const changed = [];
  for (const key of Object.keys(b).sort()) {
    if (!(key in a) && !options.ignoreAdded) added.push({ path: key, value: b[key] });
  }
  for (const key of Object.keys(a).sort()) {
    if (!(key in b)) removed.push({ path: key, value: a[key] });
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changed.push({ path: key, current: a[key], reference: b[key] });
  }
  return { added, removed, changed };
}

function metricKey(row) {
  return [row.metric, row.chart || row.series].filter(Boolean).join("/");
}

function summarizeMetricRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = metricKey(row);
    const value = Number(row.value);
    if (!key || !Number.isFinite(value)) continue;
    const bucket = byKey.get(key) ?? [];
    bucket.push({ step: Number(row.step), value });
    byKey.set(key, bucket);
  }

  const summary = {};
  for (const [key, points] of byKey.entries()) {
    const best = key.toLowerCase().includes("logloss")
      ? points.reduce((a, b) => (b.value < a.value ? b : a), points[0])
      : points.reduce((a, b) => (b.value > a.value ? b : a), points[0]);
    const last = points.at(-1);
    summary[key] = {
      points: points.length,
      bestStep: best.step,
      bestValue: best.value,
      lastStep: last.step,
      lastValue: last.value,
      deltaLastVsBest: last.value - best.value,
    };
  }
  return summary;
}

function addFinding(findings, level, code, message, detail = {}) {
  findings.push({ level, code, message, ...detail });
}

function levelRank(level) {
  return { pass: 0, info: 0, warn: 1, fail: 2 }[level] ?? 0;
}

function summarizeFindings(findings) {
  const status = findings.some((finding) => finding.level === "fail")
    ? "fail"
    : findings.some((finding) => finding.level === "warn")
      ? "warn"
      : "pass";
  return {
    status,
    counts: {
      fail: findings.filter((finding) => finding.level === "fail").length,
      warn: findings.filter((finding) => finding.level === "warn").length,
      info: findings.filter((finding) => finding.level === "info").length,
    },
  };
}

function preparedFilesFromManifest(manifest) {
  const files = [];
  if (manifest.files?.codeZip) files.push({ name: "code.zip", ...manifest.files.codeZip });
  if (manifest.files?.config) files.push({ name: "config.yaml", ...manifest.files.config });
  if (manifest.files?.runSh) files.push({ name: "run.sh", ...manifest.files.runSh });
  for (const file of manifest.files?.genericFiles ?? []) files.push({ ...file });
  return files;
}

function parseYamlMapping(buffer, name) {
  const parsed = yaml.load(buffer.toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${name}: expected YAML mapping`);
  return parsed;
}

function thresholdMention(text) {
  const match = String(text ?? "").match(/(?:阈值|threshold)\s*[:=]?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function inspectPreparedFile(bundleDir, file, findings) {
  const filePath = path.resolve(bundleDir, file.preparedPath ?? "");
  const result = {
    name: file.name,
    preparedPath: file.preparedPath,
    path: filePath,
    expectedBytes: file.bytes,
  };
  if (!file.preparedPath || !(await exists(filePath))) {
    addFinding(findings, "fail", "missing_prepared_file", `Prepared file is missing: ${file.name}`, { file: file.name });
    return result;
  }

  const buffer = await readFile(filePath);
  result.bytes = buffer.length;
  result.sha256 = createHash("sha256").update(buffer).digest("hex");

  try {
    validateTrainFileDownload({ name: file.name, size: file.bytes }, { buffer, contentType: "" });
  } catch (error) {
    addFinding(findings, "fail", "invalid_prepared_file", error instanceof Error ? error.message : String(error), { file: file.name });
  }
  return result;
}

export async function doctorBundle(options) {
  const bundleDir = path.resolve(required(options.bundleDir, "Missing bundleDir"));
  const manifestPath = path.join(bundleDir, "manifest.json");
  const findings = [];
  if (!(await exists(manifestPath))) {
    addFinding(findings, "fail", "missing_manifest", `manifest.json not found: ${manifestPath}`);
    return { bundleDir, summary: summarizeFindings(findings), findings, files: [] };
  }

  const manifest = await readJson(manifestPath);
  const files = [];
  for (const file of preparedFilesFromManifest(manifest)) {
    files.push(await inspectPreparedFile(bundleDir, file, findings));
  }

  if (manifest.git?.dirty) {
    addFinding(findings, "warn", "git_dirty", "Bundle was prepared from a dirty git working tree.", {
      head: manifest.git.head,
      statusShort: manifest.git.statusShort,
    });
  }

  const configFile = files.find((file) => file.name === "config.yaml" && file.bytes);
  if (configFile) {
    const config = parseYamlMapping(await readFile(configFile.path), "config.yaml");
    const mentionedThreshold = thresholdMention(`${manifest.job?.name ?? ""} ${manifest.job?.description ?? ""}`);
    if (mentionedThreshold != null && Number(config.item_id_oov_threshold) !== mentionedThreshold) {
      addFinding(
        findings,
        "warn",
        "description_threshold_mismatch",
        `Job text mentions threshold ${mentionedThreshold}, but config item_id_oov_threshold is ${config.item_id_oov_threshold}.`,
      );
    }
  }

  return {
    bundleDir,
    job: manifest.job ?? {},
    git: manifest.git ?? {},
    summary: summarizeFindings(findings),
    findings: findings.sort((a, b) => levelRank(b.level) - levelRank(a.level)),
    files,
  };
}

export async function verifyBundleAgainstJob(options) {
  const bundleReport = await doctorBundle({ bundleDir: options.bundleDir });
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const findings = [...bundleReport.findings];
  const files = [];

  for (const file of bundleReport.files) {
    const platformPath = trainFileLocalPath(outputDir, job.jobId, file.name);
    const platformExists = await exists(platformPath);
    const platformSha256 = platformExists ? await sha256File(platformPath) : null;
    const hashMatch = Boolean(file.sha256 && platformSha256 && file.sha256 === platformSha256);
    if (!platformExists) addFinding(findings, "fail", "missing_platform_file", `Platform file not found: ${file.name}`, { file: file.name });
    else if (!hashMatch) addFinding(findings, "fail", "platform_hash_mismatch", `Platform file hash mismatch: ${file.name}`, { file: file.name });
    files.push({ name: file.name, bundleSha256: file.sha256, platformSha256, hashMatch });
  }

  let resolvedConfig = { match: null };
  const bundleConfig = bundleReport.files.find((file) => file.name === "config.yaml");
  const resolvedConfigs = await extractResolvedConfigs(outputDir, job.jobId);
  if (bundleConfig?.path && resolvedConfigs[0]?.config) {
    const config = parseYamlMapping(await readFile(bundleConfig.path), "config.yaml");
    const diff = diffObjects(config, resolvedConfigs[0].config, { ignoreAdded: true });
    resolvedConfig = {
      match: !diff.added.length && !diff.removed.length && !diff.changed.length,
      diff,
    };
    if (!resolvedConfig.match) addFinding(findings, "fail", "resolved_config_mismatch", "Log Resolved config differs from bundle config.");
  }

  return {
    job,
    bundleDir: path.resolve(options.bundleDir),
    outputDir,
    summary: summarizeFindings(findings),
    findings: findings.sort((a, b) => levelRank(b.level) - levelRank(a.level)),
    files,
    resolvedConfig,
  };
}

export async function compareJobs(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const jobs = await loadJobRows(outputDir);
  const metrics = await readCsv(path.join(outputDir, "all-metrics-long.csv"));
  const wanted = new Set((options.jobInternalIds ?? []).map(String));
  const selected = jobs.filter((job) => !wanted.size || wanted.has(String(job.jobInternalId)));

  return {
    outputDir,
    decision: "not_provided",
    jobs: selected.map((job) => {
      const rows = metrics.filter((row) => String(row.jobInternalId) === String(job.jobInternalId));
      return {
        jobId: job.jobId,
        jobInternalId: job.jobInternalId,
        name: job.name,
        description: job.description,
        status: job.status,
        updateTime: job.updateTime,
        explicitTestScore: explicitTestScore(`${job.name} ${job.description}`),
        metrics: summarizeMetricRows(rows),
      };
    }),
  };
}

async function jobConfig(outputDir, job) {
  const configPath = trainFileLocalPath(outputDir, job.jobId, "config.yaml");
  if (await exists(configPath)) return parseYamlMapping(await readFile(configPath), "config.yaml");
  const resolved = (await extractResolvedConfigs(outputDir, job.jobId)).find((item) => item.config);
  if (resolved?.config) return resolved.config;
  throw new Error(`No config.yaml or Resolved config found for job ${job.jobInternalId}`);
}

export async function diffConfigRef(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const current = parseYamlMapping(await readFile(path.resolve(required(options.configPath, "Missing configPath"))), "config.yaml");
  const reference = await jobConfig(outputDir, job);
  return {
    configPath: path.resolve(options.configPath),
    reference: { type: "job", jobId: job.jobId, jobInternalId: job.jobInternalId },
    ...diffObjects(current, reference),
  };
}

export async function syncLedger(options = {}) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const compared = await compareJobs({ outputDir });
  const out = options.out
    ? resolveOutputPath(options.out, "ledger")
    : path.join(outputDir, "ledger", "experiments.json");
  const result = {
    generatedAt: new Date().toISOString(),
    outputDir,
    writtenTo: out,
    experiments: compared.jobs,
  };
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

export async function diagnoseJob(options) {
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUT_ROOT);
  const job = await resolveJob(outputDir, options);
  const errors = [];
  const lastLines = [];
  for (const filePath of await logFilesForJob(outputDir, job.jobId)) {
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      if (/traceback|error|exception|valueerror|runtimeerror/i.test(line)) errors.push({ file: filePath, line: index + 1, text: line });
    });
    lastLines.push({ file: filePath, lines: lines.slice(-20) });
  }
  return {
    job,
    errors,
    resolvedConfigs: await extractResolvedConfigs(outputDir, job.jobId),
    lastLines,
  };
}

function formatReport(report) {
  const lines = [`status: ${report.summary?.status ?? "unknown"}`];
  for (const finding of report.findings ?? []) lines.push(`- ${finding.level}: ${finding.code}: ${finding.message}`);
  return `${lines.join("\n")}\n`;
}

async function writeResult(result, args, defaultName) {
  if (args.out) {
    const outPath = resolveOutputPath(args.out, "reports");
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outPath}`);
    return;
  }
  console.log(args.json ? JSON.stringify(result, null, 2) : formatReport(result));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.positional.length) {
    console.log(usage());
    return;
  }

  const [domain, action] = args.positional;
  if (domain === "submit" && action === "doctor") {
    await writeResult(await doctorBundle({ bundleDir: args.bundle }), args, "doctor.json");
    return;
  }
  if (domain === "submit" && action === "verify") {
    await writeResult(await verifyBundleAgainstJob({
      bundleDir: args.bundle,
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId,
      jobId: args.jobId,
    }), args, "verify.json");
    return;
  }
  if (domain === "compare" && action === "jobs") {
    await writeResult(await compareJobs({
      outputDir: args.outputDir,
      jobInternalIds: args.positional.slice(2),
    }), { ...args, json: args.json ?? true }, "compare-jobs.json");
    return;
  }
  if (domain === "config" && action === "diff-ref") {
    await writeResult(await diffConfigRef({
      configPath: args.config,
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId,
      jobId: args.jobId,
    }), { ...args, json: args.json ?? true }, "config-diff-ref.json");
    return;
  }
  if (domain === "ledger" && action === "sync") {
    const result = await syncLedger({ outputDir: args.outputDir, out: args.out });
    if (args.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`Wrote ${result.writtenTo} (${result.experiments.length} experiments)`);
    return;
  }
  if (domain === "diagnose" && action === "job") {
    await writeResult(await diagnoseJob({
      outputDir: args.outputDir,
      jobInternalId: args.jobInternalId,
      jobId: args.jobId,
    }), { ...args, json: args.json ?? true }, "diagnose-job.json");
    return;
  }

  throw new Error(`Unsupported experiment tool command: ${args.positional.join(" ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
