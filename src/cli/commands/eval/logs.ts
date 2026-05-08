import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchEvaluationLog } from "../../../api/evaluation.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerEvalLogsCommand(evalCmd: Command) {
  evalCmd
    .command("logs")
    .description("View evaluation task logs")
    .requiredOption("--task-id <id>", "Evaluation task ID")
    .option("--output <dir>", "Output directory (default: taiji-output/eval-jobs/logs)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output/eval-jobs/logs");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const logResponse = await fetchEvaluationLog(client, opts.taskId);
      const logList = ((logResponse as Record<string, unknown>)?.data as Record<string, unknown> | undefined)?.list as unknown[] | undefined ?? [];
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, `${opts.taskId}.json`), JSON.stringify(logList, null, 2), "utf8");
      const textLines = (logList as Record<string, string>[]).map((entry) => `[${entry.time}] ${entry.message}`).join("\n");
      await writeFile(path.join(outDir, `${opts.taskId}.txt`), textLines, "utf8");
      console.log(`Saved ${logList.length} log entries for task ${opts.taskId} to ${outDir}`);
    });
}
