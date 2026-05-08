import { Command } from "commander";

export function registerEvalCreateCommand(evalCmd: Command) {
  evalCmd
    .command("create")
    .description("Create an evaluation task (not yet implemented)")
    .action(async () => {
      console.log("Create evaluation task — not yet implemented");
    });
}
