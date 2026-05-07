import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerTrainDiagnoseCommand(trainCmd: Command) {
  trainCmd
    .command("diagnose")
    .description("Diagnose a failed job")
    .requiredOption("--job-internal-id <id>", "Job internal ID")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir("taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));
      const job = data.jobsById?.[opts.jobInternalId] as Record<string, unknown> | undefined;
      if (!job) { console.error("Job not found"); process.exitCode = 1; return; }
      const diagnosis = {
        jobId: opts.jobInternalId, name: job.name, status: job.status, jzStatus: job.jzStatus,
        codeError: (job.code as Record<string, unknown> | undefined)?.error ?? null,
        instanceErrors: [] as Array<{ instanceId: string; error: unknown }>,
      };
      for (const [id, instance] of Object.entries((job.instancesById as Record<string, unknown>) ?? {})) {
        if ((instance as Record<string, unknown>).error) {
          diagnosis.instanceErrors.push({ instanceId: id, error: (instance as Record<string, unknown>).error });
        }
      }
      console.log(JSON.stringify(diagnosis, null, 2));
    });
}
