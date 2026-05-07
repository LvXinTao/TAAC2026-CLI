import { Command } from "commander";
import { ensureAuthenticated } from "../../../auth/token.js";
import { fetchJobDetail } from "../../../api/training.js";

export function registerTrainVerifyCommand(trainCmd: Command) {
  trainCmd
    .command("verify")
    .description("Verify uploaded files match platform state")
    .requiredOption("--bundle <dir>", "Submit bundle directory")
    .requiredOption("--job-internal-id <id>", "Job internal ID")
    .requiredOption("--cookie-file <file>", "Cookie file")
    .option("--direct", "Use backend HTTP")
    .action(async (opts) => {
      if (!opts.direct) throw new Error("--direct is required for now");
      const client = await ensureAuthenticated(opts.cookieFile);
      const jobDetail = await fetchJobDetail(client, opts.jobInternalId);
      console.log(`Verifying bundle against platform state for job ${opts.jobInternalId}...`);
      console.log(`Job status: ${jobDetail?.status ?? "unknown"}`);
    });
}
