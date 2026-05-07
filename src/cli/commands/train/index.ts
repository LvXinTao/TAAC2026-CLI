import { Command } from "commander";

export function registerTrainCommand(program: Command) {
  const trainCmd = program.command("train").description("Manage training tasks");
}
