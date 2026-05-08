import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchInstanceOutput, fetchJobInstances } from "../../../api/training.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { toCsv } from "../../../utils/format.js";

export function registerTrainMetricsCommand(trainCmd: Command) {
  trainCmd
    .command("metrics")
    .description("Get training job metrics")
    .requiredOption("--job-id <id>", "Job internal ID")
    .option("--json", "Output JSON to stdout instead of CSV file")
    .option("--output <dir>", "Output directory (default: taiji-output)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };

      const instances = await fetchJobInstances(client, opts.jobId, 100);
      const metricRows: any[] = [];

      for (const instance of instances) {
        const instanceId = instance.id;
        if (!instanceId) continue;
        const output = await fetchInstanceOutput(client, instanceId);
        for (const [metricName, metricPayload] of Object.entries((output as Record<string, any>).metrics ?? {})) {
          const rows = normalizeMetricRowsForExport(metricName, metricPayload);
          for (const row of rows) {
            metricRows.push({ jobId: opts.jobId, instanceId, ...row });
          }
        }
        console.log(`  Instance ${instanceId}: ${Object.keys((output as Record<string, any>).metrics ?? {}).length} metrics`);
      }

      if (opts.json) {
        console.log(JSON.stringify(metricRows, null, 2));
      } else {
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, `metrics-job-${opts.jobId}.csv`), toCsv(metricRows), "utf8");
        console.log(`Metrics saved to ${outDir}/metrics-job-${opts.jobId}.csv`);
      }
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
