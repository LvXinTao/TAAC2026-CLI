import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token.js";

export function registerTrainRunCommand(trainCmd: Command) {
  trainCmd
    .command("run")
    .description("Run a job instance")
    .requiredOption("--job-id <id>", "Job internal ID")
    .option("--cookie-file <file>", "Cookie file path")
    .action(async (opts) => {
      await ensureAuthenticated(opts.cookieFile);
      console.log(`Run job instance ${opts.jobId} — not yet implemented`);
    });
}
