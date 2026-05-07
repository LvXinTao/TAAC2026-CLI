import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerTrainCompareRunsCommand(trainCmd: Command) {
  trainCmd
    .command("compare-runs")
    .description("Compare base vs experiment job")
    .requiredOption("--base <id>", "Base job internal ID")
    .requiredOption("--exp <id>", "Experiment job internal ID")
    .option("--config", "Include config diff")
    .option("--metrics", "Include metrics comparison")
    .option("--json", "Output as JSON")
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));
      const base = data.jobsById?.[opts.base];
      const exp = data.jobsById?.[opts.exp];
      const result = {
        base: base ? { jobId: opts.base, name: base.name } : { jobId: opts.base, error: "not found" },
        exp: exp ? { jobId: opts.exp, name: exp.name } : { jobId: opts.exp, error: "not found" },
      };
      console.log(JSON.stringify(result, null, 2));
    });
}
