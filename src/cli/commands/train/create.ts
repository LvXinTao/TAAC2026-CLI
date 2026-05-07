import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token.js";

export function registerTrainCreateCommand(trainCmd: Command) {
  trainCmd
    .command("create")
    .description("Create a job from template")
    .option("--job-id <id>", "Job internal ID")
    .option("--cookie-file <file>", "Cookie file path")
    .action(async (opts) => {
      if (opts.cookieFile) {
        await ensureAuthenticated(opts.cookieFile);
      }
      console.log(`Create job from template — not yet implemented${opts.jobId ? ` (job: ${opts.jobId})` : ""}`);
    });
}
