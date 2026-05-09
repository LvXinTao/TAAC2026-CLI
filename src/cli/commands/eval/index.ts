import { Command } from "commander";
import { registerEvalCreateCommand } from "./create.js";
import { registerEvalListCommand } from "./list.js";
import { registerEvalLogsCommand } from "./logs.js";
import { registerEvalMetricsCommand } from "./metrics.js";
import { registerEvalPrepareCommand } from "./prepare.js";
import { registerEvalSubmitCommand } from "./submit.js";

export function registerEvalCommand(program: Command) {
  const evalCmd = program.command("eval").description("Manage evaluation tasks. Typical workflow: prepare -> submit");
  registerEvalPrepareCommand(evalCmd);
  registerEvalSubmitCommand(evalCmd);
  registerEvalCreateCommand(evalCmd);
  registerEvalListCommand(evalCmd);
  registerEvalLogsCommand(evalCmd);
  registerEvalMetricsCommand(evalCmd);
}
