import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token.js";

export function registerTrainDeleteCommand(trainCmd: Command) {
  trainCmd
    .command("delete")
    .description("Delete a training job")
    .requiredOption("--job-id <id>", "Job internal ID to delete")
    .option("--cookie-file <file>", "Cookie file path")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      console.log(`Delete job ${opts.jobId} — API call not yet implemented`);
    });
}
