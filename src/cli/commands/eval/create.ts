import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token.js";

export function registerEvalCreateCommand(evalCmd: Command) {
  evalCmd
    .command("create")
    .description("Create an evaluation task")
    .option("--cookie-file <file>", "Cookie file")
    .option("--direct", "Use backend HTTP")
    .action(async (opts) => {
      if (!opts.direct) throw new Error("--direct is required for now");
      const client = await ensureAuthenticated(opts.cookieFile);
      console.log("Create evaluation task — not yet implemented");
    });
}
