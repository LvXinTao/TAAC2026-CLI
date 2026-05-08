import { Command } from "commander";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchEvaluationTasks } from "../../../api/evaluation.js";

export function registerEvalMetricsCommand(evalCmd: Command) {
  evalCmd
    .command("metrics")
    .description("View evaluation task metrics")
    .requiredOption("--task-id <id>", "Evaluation task ID")
    .option("--json", "Output JSON to stdout")
    .action(async (opts) => {
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const tasks = await fetchEvaluationTasks(client, 100);
      const task = tasks.find((t) => t.id === opts.taskId);
      if (!task) { console.error("Task not found"); process.exitCode = 1; return; }
      const metrics = { id: task.id, name: task.name, score: task.score, results: task.results, infer_time: task.infer_time };
      console.log(JSON.stringify(metrics, null, 2));
    });
}
