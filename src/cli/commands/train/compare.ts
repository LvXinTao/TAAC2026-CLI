import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerTrainCompareCommand(trainCmd: Command) {
  trainCmd
    .command("compare")
    .description("Compare multiple jobs as evidence")
    .argument("<jobIds...>", "Job internal IDs")
    .option("--out <dir>", "Output directory")
    .option("--json", "Output as JSON")
    .action(async (jobIds, opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));
      const results = jobIds.map((id: string) => {
        const job = data.jobsById?.[id];
        if (!job) return { jobId: id, error: "not found" };
        return { jobId: id, name: job.name, description: job.description, status: job.status, instances: Object.keys(job.instancesById ?? {}).length };
      });
      console.log(JSON.stringify(results, null, 2));
    });
}
