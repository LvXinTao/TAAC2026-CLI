import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchEvaluationTasks, fetchEvaluationLog } from "../../../api/evaluation.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { toCsv } from "../../../utils/format.js";

export function registerEvalListCommand(evalCmd: Command) {
  evalCmd
    .command("list")
    .description("Scrape evaluation task list")
    .option("--page-size <n>", "Page size", (v: string) => parseInt(v, 10))
    .option("--output <dir>", "Output directory (default: taiji-output)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const tasks = await fetchEvaluationTasks(client, opts.pageSize ?? 100);
      console.log(`Found ${tasks.length} evaluation tasks`);

      const evalLogDir = path.join(outDir, "eval-jobs", "logs");
      await mkdir(evalLogDir, { recursive: true });

      const tasksById: Record<string, Record<string, unknown>> = {};
      for (const task of tasks) {
        const taskId = task.id;
        if (!taskId) continue;
        tasksById[taskId] = { ...task };
        try {
          const logResponse = await fetchEvaluationLog(client, taskId);
          const logList = ((logResponse as Record<string, unknown>)?.data as Record<string, unknown> | undefined)?.list as unknown[] | undefined ?? [];
          await writeFile(path.join(evalLogDir, `${taskId}.json`), JSON.stringify(logList, null, 2), "utf8");
          const textLines = (logList as Record<string, string>[]).map((entry) => `[${entry.time}] ${entry.message}`).join("\n");
          await writeFile(path.join(evalLogDir, `${taskId}.txt`), textLines, "utf8");
          tasksById[taskId].log = { entries: logList.length, path: `eval-jobs/logs/${taskId}.txt` };
        } catch (error) {
          tasksById[taskId].log = { error: String(error) };
        }
      }

      await writeFile(path.join(outDir, "eval-tasks.json"), JSON.stringify({
        sourceUrl: "https://taiji.algo.qq.com/evaluation",
        fetchedAt: new Date().toISOString(),
        count: tasks.length,
        tasksById,
      }, null, 2), "utf8");

      await writeFile(path.join(outDir, "eval-tasks-summary.csv"), toCsv(tasks.map((t) => {
        const results = (t as unknown as Record<string, unknown>).results as Record<string, unknown> | undefined;
        return {
          id: t.id, name: t.name, status: t.status, score: t.score ?? "",
          auc: results?.auc ?? "", infer_time: t.infer_time ?? "",
        };
      })), "utf8");

      console.log(`Saved ${tasks.length} evaluation tasks to ${outDir}`);
    });
}
