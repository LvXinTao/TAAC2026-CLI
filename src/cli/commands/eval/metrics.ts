import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchEvaluationTasks } from "../../../api/evaluation.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

export function registerEvalMetricsCommand(evalCmd: Command) {
  evalCmd
    .command("metrics")
    .description("View evaluation task metrics")
    .requiredOption("--task-id <id>", "Evaluation task ID")
    .option("--json", "Output JSON to stdout instead of file")
    .option("--output <dir>", "Output directory (default: taiji-output/eval-jobs/metrics)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output/eval-jobs/metrics");
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const tasks = await fetchEvaluationTasks(client, 100);
      const task = tasks.find((t) => String(t.id) === String(opts.taskId));
      if (!task) { console.error("Task not found"); process.exitCode = 1; return; }
      const metrics = { id: task.id, name: task.name, score: task.score, results: task.results, infer_time: task.infer_time };
      if (opts.json) {
        console.log(JSON.stringify(metrics, null, 2));
      } else {
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, `${opts.taskId}.json`), JSON.stringify(metrics, null, 2), "utf8");
        console.log(`Saved metrics for task ${opts.taskId} to ${outDir}`);
      }
    });
}
