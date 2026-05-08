import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchJobDetail, fetchJobInstances, fetchInstanceOutput, fetchInstanceLog } from "../../../api/training.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { normalizeLogLines, toCsv } from "../../../utils/format.js";

const AUTH_WAIT_MS = 180_000;

export function registerTrainDescribeCommand(trainCmd: Command) {
  trainCmd
    .command("describe")
    .description("Fetch full details of a single training job")
    .requiredOption("--job-id <id>", "Job internal ID")
    .option("--output <dir>", "Output directory (default: taiji-output)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const jobId = opts.jobId;

      // Fetch job detail
      const jobDetail = await fetchJobDetail(client, jobId, AUTH_WAIT_MS);

      // Fetch instances
      const instances = await fetchJobInstances(client, jobId, 100, AUTH_WAIT_MS);
      console.log(`Job ${jobId}: ${instances.length} instances`);

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
          const logDir = path.join(outDir, "logs", jobId);
          await mkdir(logDir, { recursive: true });
          const lines = normalizeLogLines(logResponse);
          await writeFile(path.join(logDir, `${instanceId}.json`), JSON.stringify(logResponse, null, 2), "utf8");
          await writeFile(path.join(logDir, `${instanceId}.txt`), lines.join("\n"), "utf8");

          instancesById[instanceId] = {
            instanceId,
            rawInstance: instance,
            ...output,
            log: { path: `logs/${jobId}/${instanceId}.txt`, lines: lines.length },
            error: null,
          };

          // Collect metrics and checkpoints
          for (const [metricName, metricPayload] of Object.entries((output as Record<string, any>).metrics ?? {})) {
            const rows = normalizeMetricRowsForExport(metricName, metricPayload);
            for (const row of rows) {
              metricRows.push({ jobId, instanceId, ...row });
            }
          }
          const ckpts = Array.isArray((output as Record<string, any>).checkpoints) ? (output as Record<string, any>).checkpoints : [];
          for (const ckpt of ckpts) {
            checkpointRows.push({
              jobId, instanceId,
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
      await writeFile(path.join(outDir, `job-${jobId}.json`), JSON.stringify({
        jobId, jobDetail, instancesById,
        fetchedAt: new Date().toISOString(),
      }, null, 2), "utf8");

      if (metricRows.length) {
        await writeFile(path.join(outDir, `job-${jobId}-metrics.csv`), toCsv(metricRows), "utf8");
      }
      if (checkpointRows.length) {
        await writeFile(path.join(outDir, `job-${jobId}-checkpoints.csv`), toCsv(checkpointRows), "utf8");
      }

      console.log(`Saved job ${jobId} details to ${outDir}`);
    });
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
