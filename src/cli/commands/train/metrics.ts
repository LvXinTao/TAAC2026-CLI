import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated, createDirectClient } from "../../../auth/token.js";
import { fetchInstanceOutput, fetchJobInstances } from "../../../api/training.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { toCsv } from "../../../utils/format.js";

export function registerTrainMetricsCommand(trainCmd: Command) {
  trainCmd
    .command("metrics")
    .description("Get training job metrics")
    .requiredOption("--job <id>", "Job internal ID")
    .option("--cookie-file <file>", "Cookie file path")
    .option("--direct", "Use backend HTTP")
    .option("--json", "Output as JSON")
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const client = opts.direct ? await createDirectClient(opts.cookieFile) : null;
      if (!client) throw new Error("--direct is required for now");

      const instances = await fetchJobInstances(client, opts.job, 100);
      const metricRows: any[] = [];

      for (const instance of instances) {
        const instanceId = instance.id;
        if (!instanceId) continue;
        const output = await fetchInstanceOutput(client, instanceId);
        for (const [metricName, metricPayload] of Object.entries(output.metrics ?? {})) {
          const rows = normalizeMetricRowsForExport(metricName, metricPayload);
          for (const row of rows) {
            metricRows.push({ jobId: opts.job, instanceId, ...row });
          }
        }
        console.log(`  Instance ${instanceId}: ${Object.keys(output.metrics ?? {}).length} metrics`);
      }

      if (opts.json) {
        console.log(JSON.stringify(metricRows, null, 2));
      } else {
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, `metrics-job-${opts.job}.csv`), toCsv(metricRows), "utf8");
        console.log(`Metrics saved to ${outDir}/metrics-job-${opts.job}.csv`);
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
