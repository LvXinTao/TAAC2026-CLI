import { Command } from "commander";

export function registerEvalCommand(program: Command) {
  const evalCmd = program.command("eval").description("Manage evaluation tasks");
}
