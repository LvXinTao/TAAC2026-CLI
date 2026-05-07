import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token.js";
import { fetchEvaluationTasks } from "../../../api/evaluation.js";

export function registerEvalMetricsCommand(evalCmd: Command) {
  evalCmd
    .command("metrics")
    .description("View evaluation task metrics")
    .requiredOption("--task-id <id>", "Evaluation task ID")
    .option("--cookie-file <file>", "Cookie file")
    .option("--direct", "Use backend HTTP")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      if (!opts.direct) throw new Error("--direct is required for now");
      const client = await ensureAuthenticated(opts.cookieFile);
      const tasks = await fetchEvaluationTasks(client, 100);
      const task = tasks.find((t) => t.id === opts.taskId);
      if (!task) { console.error("Task not found"); process.exitCode = 1; return; }
      const metrics = { id: task.id, name: task.name, score: task.score, results: task.results, infer_time: task.infer_time };
      console.log(opts.json ? JSON.stringify(metrics, null, 2) : JSON.stringify(metrics, null, 2));
    });
}
