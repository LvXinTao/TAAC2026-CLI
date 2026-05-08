import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchJobDetail, fetchJobInstances, fetchInstanceOutput, fetchInstanceLog } from "../../../api/training.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { normalizeLogLines, toCsv } from "../../../utils/format.js";

const AUTH_WAIT_MS = 180_000;

async function loadJobsMapping(jobsFile: string): Promise<Record<string, { jobId: string; jobInternalId: number }>> {
  const data = JSON.parse(await readFile(jobsFile, "utf8"));
  return data.jobsById ?? {};
}

export function registerTrainDescribeCommand(trainCmd: Command) {
  trainCmd
    .command("describe")
    .description("Fetch full details of a training job, or all jobs with --all. --job-id accepts the full taskID string (angel_training_...).")
    .option("--job-id <id>", "Job ID — the full taskID string (angel_training_...). Use --all instead to describe all jobs.")
    .option("--all", "Describe all jobs from jobs.json")
    .option("--output <dir>", "Output directory (default: taiji-output/train-jobs)")
    .action(async (opts) => {
      if (!opts.jobId && !opts.all) {
        console.error("Error: specify either --job-id or --all");
        process.exit(1);
      }
      if (opts.jobId && opts.all) {
        console.error("Error: --job-id and --all are mutually exclusive");
        process.exit(1);
      }

      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output/train-jobs");
      const jobsFile = path.join(outDir, "../jobs.json");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };

      if (opts.all) {
        const jobsById = await loadJobsMapping(jobsFile);
        for (const entry of Object.values(jobsById)) {
          await describeJob(client, entry.jobId, String(entry.jobInternalId), outDir);
        }
      } else {
        const jobsById = await loadJobsMapping(jobsFile);
        const entry = jobsById[opts.jobId];
        if (!entry) {
          console.error(`Job ${opts.jobId} not found in jobs.json. Run "train list" first.`);
          process.exit(1);
        }
        await describeJob(client, entry.jobId, String(entry.jobInternalId), outDir);
      }
    });
}

async function describeJob(client: any, taskId: string, internalId: string, outDir: string): Promise<void> {
  // Fetch job detail (needs numeric internalId)
  const jobDetail = await fetchJobDetail(client, internalId, AUTH_WAIT_MS);

  // Fetch instances (needs string taskId)
  const instances = await fetchJobInstances(client, taskId, 100, AUTH_WAIT_MS);
  console.log(`Job ${taskId}: ${instances.length} instances`);

  const instancesById: Record<string, unknown> = {};
  const metricRows: any[] = [];
  const checkpointRows: any[] = [];

  for (const instance of instances) {
    const instanceId = instance.id;
    if (!instanceId) continue;

    try {
      const [output, logResponse] = await Promise.all([
        fetchInstanceOutput(client, instanceId, AUTH_WAIT_MS),
        fetchInstanceLog(client, instanceId, AUTH_WAIT_MS),
      ]);
      const logDir = path.join(outDir, "logs", taskId);
      await mkdir(logDir, { recursive: true });
      const lines = normalizeLogLines(logResponse);
      await writeFile(path.join(logDir, `${instanceId}.json`), JSON.stringify(logResponse, null, 2), "utf8");
      await writeFile(path.join(logDir, `${instanceId}.txt`), lines.join("\n"), "utf8");

      instancesById[instanceId] = {
        instanceId,
        rawInstance: instance,
        ...output,
        log: { path: `logs/${taskId}/${instanceId}.txt`, lines: lines.length },
        error: null,
      };

      // Collect metrics and checkpoints
      for (const [metricName, metricPayload] of Object.entries((output as Record<string, any>).metrics ?? {})) {
        const rows = normalizeMetricRowsForExport(metricName, metricPayload);
        for (const row of rows) {
          metricRows.push({ jobId: taskId, instanceId, ...row });
        }
      }
      const ckpts = Array.isArray((output as Record<string, any>).checkpoints) ? (output as Record<string, any>).checkpoints : [];
      for (const ckpt of ckpts) {
        checkpointRows.push({
          jobId: taskId, instanceId,
          ckpt: ckpt.ckpt, ckptFileSize: ckpt.ckpt_file_size,
          createTime: ckpt.create_time, deleteTime: ckpt.deleteTime, status: ckpt.status,
        });
      }

      const metricCount = Object.keys((output as Record<string, any>).metrics ?? {}).length;
      console.log(`  Instance ${instanceId}: ${metricCount} metrics, ${lines.length} log lines`);
    } catch (error) {
      instancesById[instanceId] = {
        instanceId,
        rawInstance: instance,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Write output
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `job-${taskId}.json`), JSON.stringify({
    jobId: taskId, jobDetail, instancesById,
    fetchedAt: new Date().toISOString(),
  }, null, 2), "utf8");

  if (metricRows.length) {
    await writeFile(path.join(outDir, `job-${taskId}-metrics.csv`), toCsv(metricRows), "utf8");
  }
  if (checkpointRows.length) {
    await writeFile(path.join(outDir, `job-${taskId}-checkpoints.csv`), toCsv(checkpointRows), "utf8");
  }

  console.log(`Saved job ${taskId} details to ${outDir}`);
}

function normalizeMetricRowsForExport(metricName: string, payload: unknown): any[] {
  if (!payload) return [];
  const arr = Array.isArray(payload) ? payload : [payload];
  return arr.flatMap((p: any, i: number) => {
    const dates = Array.isArray(p?.date) ? p.date : [];
    const titles = Array.isArray(p?.title) ? p.title : [];
    const values = Array.isArray(p?.value) ? p.value : [];
    const rows: any[] = [];
    for (let si = 0; si < Math.max(titles.length, values.length); si++) {
      const seriesName = titles[si] ?? `${metricName}_${si}`;
      const seriesValues = Array.isArray(values[si]) ? values[si] : [];
      for (let pi = 0; pi < seriesValues.length; pi++) {
        rows.push({ metric: metricName, series: seriesName, step: dates[pi] ?? pi, value: seriesValues[pi] });
      }
    }
    return rows;
  });
}
