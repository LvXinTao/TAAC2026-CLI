import { Command } from "commander";
import { registerTrainListCommand } from "./list.js";
import { registerTrainDescribeCommand } from "./describe.js";
import { registerTrainLogsCommand } from "./logs.js";
import { registerTrainMetricsCommand } from "./metrics.js";
import { registerTrainStopCommand } from "./stop.js";
import { registerTrainDeleteCommand } from "./delete.js";
import { registerTrainPrepareCommand } from "./prepare.js";
import { registerTrainSubmitCommand } from "./submit.js";

export function registerTrainCommand(program: Command) {
  const trainCmd = program.command("train").description("Manage training tasks");
  registerTrainPrepareCommand(trainCmd);
  registerTrainSubmitCommand(trainCmd);
  registerTrainListCommand(trainCmd);
  registerTrainDescribeCommand(trainCmd);
  registerTrainLogsCommand(trainCmd);
  registerTrainMetricsCommand(trainCmd);
  registerTrainStopCommand(trainCmd);
  registerTrainDeleteCommand(trainCmd);
}
