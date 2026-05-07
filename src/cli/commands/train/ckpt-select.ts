import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerTrainCkptSelectCommand(trainCmd: Command) {
  trainCmd
    .command("ckpt-select")
    .description("Select checkpoint candidates by metric rules")
    .requiredOption("--job <id>", "Job internal ID")
    .option("--by <metric>", "Metric to sort by", "valid_auc")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir("taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));
      const job = data.jobsById?.[opts.job];
      if (!job) { console.error("Job not found"); process.exitCode = 1; return; }
      const ckpts: unknown[] = [];
      for (const [, instanceVal] of Object.entries(job.instancesById ?? {} as Record<string, Record<string, unknown>>)) {
        const instance = instanceVal as Record<string, unknown>;
        for (const ckpt of (instance.checkpoints as unknown[] | undefined) ?? []) {
          ckpts.push({ instanceId: instance.instanceId as string, ...(ckpt as Record<string, unknown>) });
        }
      }
      console.log(JSON.stringify(ckpts.slice(0, 5), null, 2));
    });
}
