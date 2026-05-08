import { Command } from "commander";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { fetchJson } from "../../../api/client.js";

export function registerTrainDeleteCommand(trainCmd: Command) {
  trainCmd
    .command("delete")
    .description("Delete a training job")
    .requiredOption("--job-id <id>", "Job internal ID to delete")
    .option("--yes", "Skip confirmation prompt", false)
    .action(async (opts) => {
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };
      const jobId = opts.jobId;

      if (!opts.yes) {
        process.stdout.write(`Are you sure you want to delete job ${jobId}? [y/N] `);
        const answer = await new Promise<string>((resolve) => {
          process.stdin.once("data", (data) => resolve(data.toString().trim().toLowerCase()));
          setTimeout(() => resolve("n"), 10000);
        });
        if (answer !== "y" && answer !== "yes") {
          console.log("Cancelled.");
          return;
        }
      }

      console.log(`Deleting job ${jobId}…`);
      try {
        const response = await fetchJson(client, `/taskmanagement/api/v1/webtasks/external/task/${jobId}`, {
          method: "DELETE",
        });
        console.log(`Job ${jobId} deleted:`, JSON.stringify(response, null, 2));
      } catch (error) {
        console.error(`Failed to delete job ${jobId}:`, (error as Error).message);
        process.exitCode = 1;
      }
    });
}
