import { Command } from "commander";
import { registerEvalCreateCommand } from "./create.js";
import { registerEvalListCommand } from "./list.js";
import { registerEvalLogsCommand } from "./logs.js";
import { registerEvalMetricsCommand } from "./metrics.js";

export function registerEvalCommand(program: Command) {
  const evalCmd = program.command("eval").description("Manage evaluation tasks");
  registerEvalCreateCommand(evalCmd);
  registerEvalListCommand(evalCmd);
  registerEvalLogsCommand(evalCmd);
  registerEvalMetricsCommand(evalCmd);
}
