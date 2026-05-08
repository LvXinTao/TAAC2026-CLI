import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchInstanceLog, fetchJobInstances } from "../../../api/training.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { normalizeLogLines } from "../../../utils/format.js";

export function registerTrainLogsCommand(trainCmd: Command) {
  trainCmd
    .command("logs")
    .description("Get training job logs")
    .requiredOption("--job-id <id>", "Job ID (taskID string)")
    .option("--output <dir>", "Output directory (default: taiji-output/train-jobs)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output/train-jobs");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };

      const logDir = path.join(outDir, "logs", opts.jobId);
      await mkdir(logDir, { recursive: true });

      const instances = await fetchJobInstances(client, opts.jobId, 100);
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
