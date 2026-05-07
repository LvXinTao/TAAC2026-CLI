import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerTrainLedgerCommand(trainCmd: Command) {
  trainCmd
    .command("ledger")
    .description("Sync structured experiment ledger")
    .argument("action", "Action: sync")
    .option("--out <file>", "Output file")
    .option("--output-dir <dir>", "Output directory")
    .action(async (action, opts) => {
      if (action !== "sync") { console.error("Only 'sync' action supported"); process.exitCode = 1; return; }
      const outDir = resolveTaijiOutputDir(opts.outputDir ?? "taiji-output");
      const jobsFile = path.join(outDir, "jobs.json");
      const data = JSON.parse(await readFile(jobsFile, "utf8"));
      const ledger = Object.values(data.jobsById ?? {} as Record<string, Record<string, unknown>>).map((job: unknown) => {
        const j = job as Record<string, unknown>;
        return {
          jobId: j.jobId, jobInternalId: j.jobInternalId, name: j.name, description: j.description,
          status: j.status, jzStatus: j.jzStatus, instances: Object.keys((j.instancesById as Record<string, unknown>) ?? {}).length,
        };
      });
      const outPath = path.join(outDir, opts.out ?? "ledger.json");
      await writeFile(outPath, JSON.stringify(ledger, null, 2), "utf8");
      console.log(`Ledger synced: ${ledger.length} jobs to ${outPath}`);
    });
}
