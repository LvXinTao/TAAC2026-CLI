import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated } from "../../../auth/token.js";
import { fetchEvaluationLog } from "../../../api/evaluation.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerEvalLogsCommand(evalCmd: Command) {
  evalCmd
    .command("logs")
    .description("View evaluation task logs")
    .requiredOption("--task-id <id>", "Evaluation task ID")
    .option("--cookie-file <file>", "Cookie file")
    .option("--direct", "Use backend HTTP")
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      if (!opts.direct) throw new Error("--direct is required for now");
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      const client = await ensureAuthenticated(opts.cookieFile);
      const logResponse = await fetchEvaluationLog(client, opts.taskId);
      const logList = ((logResponse as Record<string, unknown>)?.data as Record<string, unknown> | undefined)?.list as unknown[] | undefined ?? [];
      const logDir = path.join(outDir, "eval-logs");
      await mkdir(logDir, { recursive: true });
      await writeFile(path.join(logDir, `${opts.taskId}.json`), JSON.stringify(logList, null, 2), "utf8");
      const textLines = (logList as Record<string, string>[]).map((entry) => `[${entry.time}] ${entry.message}`).join("\n");
      await writeFile(path.join(logDir, `${opts.taskId}.txt`), textLines, "utf8");
      console.log(`Saved ${logList.length} log entries for task ${opts.taskId}`);
    });
}
