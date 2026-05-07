import { Command } from "commander";
import { registerTrainListCommand } from "./list.js";
import { registerTrainLogsCommand } from "./logs.js";
import { registerTrainMetricsCommand } from "./metrics.js";

export function registerTrainCommand(program: Command) {
  const trainCmd = program.command("train").description("Manage training tasks");
  registerTrainListCommand(trainCmd);
  registerTrainLogsCommand(trainCmd);
  registerTrainMetricsCommand(trainCmd);
}
