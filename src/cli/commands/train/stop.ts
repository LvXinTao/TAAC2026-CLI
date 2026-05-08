import { Command } from "commander";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchJson } from "../../../api/client.js";

export function registerTrainStopCommand(trainCmd: Command) {
  trainCmd
    .command("stop")
    .description("Stop a training job")
    .requiredOption("--job-internal-id <id>", "Job internal ID to stop (numeric)")
    .action(async (opts) => {
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const jobId = opts.jobInternalId;
      console.log(`Stopping job ${jobId}…`);
      try {
        const response = await fetchJson(client, `/taskmanagement/api/v1/webtasks/external/task/${jobId}/stop`, {
          method: "POST",
        });
        console.log(`Job ${jobId} stopped:`, JSON.stringify(response, null, 2));
      } catch (error) {
        console.error(`Failed to stop job ${jobId}:`, (error as Error).message);
        process.exitCode = 1;
      }
    });
}
