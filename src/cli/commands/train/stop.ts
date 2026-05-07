import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token.js";

export function registerTrainStopCommand(trainCmd: Command) {
  trainCmd
    .command("stop")
    .description("Stop a training job")
    .requiredOption("--job-id <id>", "Job internal ID to stop")
    .option("--cookie-file <file>", "Cookie file path")
    .action(async (opts) => {
      const client = await ensureAuthenticated(opts.cookieFile);
      console.log(`Stop job ${opts.jobId} — API call not yet implemented`);
    });
}
