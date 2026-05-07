import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated, createDirectClient } from "../../../auth/token.js";
import { fetchInstanceLog, fetchJobInstances } from "../../../api/training.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { normalizeLogLines } from "../../../utils/format.js";

export function registerTrainLogsCommand(trainCmd: Command) {
  trainCmd
    .command("logs")
    .description("Get training job logs")
    .requiredOption("--job <id>", "Job internal ID")
    .option("--cookie-file <file>", "Cookie file path")
    .option("--direct", "Use backend HTTP")
    .option("--errors", "Only show error lines")
    .option("--tail <n>", "Last N lines", (v) => parseInt(v, 10))
    .option("--json", "Output as JSON")
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const client = opts.direct ? await createDirectClient(opts.cookieFile) : null;
      if (!client) throw new Error("--direct is required for now");

      const logDir = path.join(outDir, "logs", opts.job);
      await mkdir(logDir, { recursive: true });

      const instances = await fetchJobInstances(client, opts.job, 100);
      for (const instance of instances) {
        const instanceId = instance.id;
        if (!instanceId) continue;
        try {
          const logResponse = await fetchInstanceLog(client, instanceId);
          const lines = normalizeLogLines(logResponse);
          await writeFile(path.join(logDir, `${instanceId}.json`), JSON.stringify(logResponse, null, 2), "utf8");
          await writeFile(path.join(logDir, `${instanceId}.txt`), lines.join("\n"), "utf8");
          console.log(`  Instance ${instanceId}: ${lines.length} log lines`);
        } catch (error) {
          console.log(`  Instance ${instanceId}: failed: ${error}`);
        }
      }
      console.log(`Logs saved to ${logDir}`);
    });
}
