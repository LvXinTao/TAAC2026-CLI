import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createBrowserContext, DEFAULTS as BROWSER_DEFAULTS } from "../../../auth/browser.js";
import { parseCookieEntries } from "../../../auth/token.js";
import { fetchTrainingJobs } from "../../../api/training.js";
import { resolveSecretPath } from "../../../cli/middleware.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { toCsv } from "../../../utils/format.js";

const TRAINING_URL = "https://taiji.algo.qq.com/training";

export function registerTrainListCommand(trainCmd: any) {
  trainCmd
    .command("list")
    .description("List training job summaries")
    .option("--incremental", "Skip unchanged terminal jobs")
    .option("--page-size <n>", "Page size", (v: string) => parseInt(v, 10))
    .option("--output <dir>", "Output directory (default: taiji-output)")
    .action(async (opts: any) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output");
      await mkdir(outDir, { recursive: true });
      const pageSize = opts.pageSize ?? 100;

      const userDataDir = path.resolve(outDir, "browser-profile");
      const context = await createBrowserContext(userDataDir, true);
      try {
        // Inject cookie from secrets file
        const secretPath = resolveSecretPath();
        const cookieHeader = (await readFile(secretPath, "utf8")).trim();
        const cookies = parseCookieEntries(cookieHeader);
        if (cookies.length === 0) {
          throw new Error(`No valid cookies found in ${secretPath}. Please save your Taiji cookie to this file.`);
        }
        await context.addCookies(
          cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: "taiji.algo.qq.com",
            path: "/",
          }))
        );

        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(TRAINING_URL, { waitUntil: "domcontentloaded", timeout: BROWSER_DEFAULTS.TIMEOUT_MS });

        const listedJobs = await fetchTrainingJobs(page, pageSize, BROWSER_DEFAULTS.AUTH_WAIT_MS);

        // --incremental: merge with existing jobs.json, skip unchanged terminal jobs
        const jobsFile = path.join(outDir, "jobs.json");
        let existingJobsById: Record<string, any> = {};
        if (opts.incremental) {
          try {
            const existing = JSON.parse(await readFile(jobsFile, "utf8"));
            existingJobsById = existing.jobsById ?? existing.jobsById ?? {};
          } catch {
            // no existing file, start fresh
          }
        }

        const fetchedAt = new Date().toISOString();
        const jobsById: Record<string, any> = {};

        for (const job of listedJobs) {
          const jobId = job.taskID;
          if (!jobId) continue;

          if (opts.incremental && existingJobsById[jobId]) {
            const existing = existingJobsById[jobId];
            if (
              isTerminalJob(job) &&
              (existing.status ?? "") === (job.status ?? "") &&
              (existing.jzStatus ?? "") === (job.jzStatus ?? "") &&
              (existing.updateTime ?? "") === (job.updateTime ?? "")
            ) {
              jobsById[jobId] = existing;
              console.log(`Job ${jobId}: skipped (unchanged terminal job)`);
              continue;
            }
          }

          jobsById[jobId] = {
            jobId,
            jobInternalId: job.id,
            name: job.name ?? "",
            description: job.description ?? "",
            status: job.status,
            jzStatus: job.jzStatus,
            updateTime: job.updateTime,
            rawJob: job,
          };
        }

        const result = {
          sourceUrl: TRAINING_URL,
          fetchedAt,
          syncMode: opts.incremental ? "incremental" : "full",
          jobsListed: listedJobs.length,
          jobsById,
        };

        await writeFile(jobsFile, JSON.stringify(result, null, 2), "utf8");

        const summaryRows = Object.values(jobsById).map((j: any) => ({
          jobId: j.jobId,
          jobInternalId: j.jobInternalId,
          name: j.name,
          description: j.description,
          status: j.status,
          jzStatus: j.jzStatus,
          updateTime: j.updateTime,
        }));
        await writeFile(path.join(outDir, "jobs-summary.csv"), toCsv(summaryRows), "utf8");

        console.log(`Saved ${Object.keys(jobsById).length} jobs to ${outDir}`);
      } finally {
        await context.close();
      }
    });
}

function isTerminalJob(job: any): boolean {
  const status = String(job?.status ?? "").toUpperCase();
  const jzStatus = String(job?.jzStatus ?? "").toUpperCase();
  return jzStatus === "END" || ["SUCCEED", "FAILED", "KILLED", "CANCELED", "CANCELLED"].includes(status);
}
