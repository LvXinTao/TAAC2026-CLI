import { Command } from "commander";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureAuthenticated, isDirectClient, createDirectClient } from "../../../auth/token.js";
import { createBrowserContext, addCookiesToBrowser, waitForLogin, DEFAULTS as BROWSER_DEFAULTS } from "../../../auth/browser.js";
import { fetchTrainingJobs, fetchJobDetail, fetchJobInstances, fetchInstanceOutput, fetchInstanceLog } from "../../../api/training.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";
import { toCsv, normalizeLogLines, safePathPart } from "../../../utils/format.js";

const TRAINING_URL = "https://taiji.algo.qq.com/training";
const DEFAULT_API_AUTH_WAIT_MS = 180_000;
const METRIC_SAFE_NAME = /[^a-zA-Z0-9._-]+/g;

function isTerminalJob(job: any): boolean {
  const status = String(job?.status ?? "").toUpperCase();
  const jzStatus = String(job?.jzStatus ?? "").toUpperCase();
  return jzStatus === "END" || ["SUCCEED", "FAILED", "KILLED", "CANCELED", "CANCELLED"].includes(status);
}

function hasCompleteCachedDeepSync(current: any): boolean {
  if (!current) return false;
  if (!current.code || current.code.error) return false;
  const DOWNLOAD_VALIDATION_VERSION = 2;
  if (current.code.downloadVersion !== DOWNLOAD_VALIDATION_VERSION) return false;
  const instances = Object.values(current.instancesById ?? {});
  if (!instances.length) return false;
  return instances.every((instance: any) => !instance?.error);
}

function shouldSkipJobDeepSync(current: any, listedJob: any, incremental: boolean): { skip: boolean; reason: string } {
  if (!incremental) return { skip: false, reason: "incremental_disabled" };
  if (!current) return { skip: false, reason: "new_job" };
  if (!hasCompleteCachedDeepSync(current)) return { skip: false, reason: "incomplete_cached_job" };
  if (!isTerminalJob(listedJob)) return { skip: false, reason: "non_terminal_job" };
  if (current.updateTime !== listedJob.updateTime) return { skip: false, reason: "update_time_changed" };
  if ((current.status ?? "") !== (listedJob.status ?? current.status ?? "")) return { skip: false, reason: "status_changed" };
  if ((current.jzStatus ?? "") !== (listedJob.jzStatus ?? current.jzStatus ?? "")) return { skip: false, reason: "jz_status_changed" };
  return { skip: true, reason: "unchanged_terminal_job" };
}

async function readJsonIfExists(filePath: string, fallback: any): Promise<any> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function registerTrainListCommand(trainCmd: any) {
  trainCmd
    .command("list")
    .description("Scrape training job list with details")
    .option("--all", "Scrape all training jobs")
    .option("--cookie-file <file>", "Cookie file path")
    .option("--direct", "Use backend HTTP instead of browser")
    .option("--headless", "Launch Chromium in headless mode")
    .option("--incremental", "Skip unchanged terminal jobs")
    .option("--job-internal-id <id>", "Target one internal job ID")
    .option("--job-id <id>", "Target one platform task ID")
    .option("--page-size <n>", "Page size", (v: string) => parseInt(v, 10))
    .option("--out <dir>", "Output directory")
    .option("--timeout <ms>", "Timeout in ms", (v: string) => parseInt(v, 10))
    .action(async (opts: any) => {
      const outDir = resolveTaijiOutputDir(opts.out ?? "taiji-output");
      await mkdir(outDir, { recursive: true });
      const pageSize = opts.pageSize ?? 100;
      const timeoutMs = opts.timeout ?? BROWSER_DEFAULTS.TIMEOUT_MS;
      const authTimeoutMs = Math.max(timeoutMs, DEFAULT_API_AUTH_WAIT_MS);

      if (opts.direct) {
        if (!opts.cookieFile) throw new Error("--direct requires --cookie-file");
        const client = await createDirectClient(opts.cookieFile);
        await runScrape(client, opts, outDir, pageSize, authTimeoutMs);
        return;
      }

      const userDataDir = path.resolve(outDir, "browser-profile");
      const context = await createBrowserContext(userDataDir, opts.headless ?? false);
      try {
        if (opts.cookieFile) await addCookiesToBrowser(context, opts.cookieFile);
        const page = context.pages()[0] ?? (await context.newPage());
        await runScrape(page, opts, outDir, pageSize, authTimeoutMs, timeoutMs);
      } finally {
        await context.close();
      }
    });
}

async function runScrape(client: any, opts: any, outDir: string, pageSize: number, authTimeoutMs: number, timeoutMs?: number): Promise<void> {
  // Browser mode: navigate to page first
  if (!isDirectClient(client) && timeoutMs) {
    await waitForLogin(client, "https://taiji.algo.qq.com/training", timeoutMs, ["Model Training Job", "模型训练任务", "Job ID", "任务ID"]);
  }

  const jobsFile = path.join(outDir, "jobs.json");
  const existing = await readJsonIfExists(jobsFile, { jobsById: {} });
  const jobsById = existing.jobsById ?? {};

  const listedJobs = await fetchTrainingJobs(client, pageSize, authTimeoutMs);
  const jobs = filterJobsForArgs(listedJobs, opts);
  const syncStartedAt = new Date().toISOString();
  const syncStats = { jobsListed: listedJobs.length, jobsMatched: jobs.length, deepFetched: 0, skippedDeepSync: 0, failedDeepFetch: 0 };

  console.log(opts.jobInternalId || opts.jobId ? `Found ${jobs.length} matching jobs` : `Found ${jobs.length} jobs`);
  if ((opts.jobInternalId || opts.jobId) && jobs.length === 0) {
    throw new Error(`No job matched ${opts.jobInternalId ? `--job-internal-id ${opts.jobInternalId}` : `--job-id ${opts.jobId}`}`);
  }

  for (const job of jobs) {
    const jobId = job.taskID;
    if (!jobId) continue;

    const current = jobsById[jobId] ?? {};
    const jobRecord = {
      ...current,
      jobId,
      jobInternalId: job.id,
      name: job.name ?? current.name ?? "",
      description: job.description ?? current.description ?? "",
      status: job.status ?? current.status,
      jzStatus: job.jzStatus ?? current.jzStatus,
      updateTime: job.updateTime ?? current.updateTime,
      rawJob: job,
      instancesById: current.instancesById ?? {},
    };

    const skipDecision = shouldSkipJobDeepSync(current, job, opts.incremental ?? false);
    if (skipDecision.skip) {
      jobRecord.sync = {
        ...(current.sync ?? {}),
        skippedDeepSync: true,
        skipReason: skipDecision.reason,
        lastSeenAt: syncStartedAt,
      };
      jobsById[jobId] = jobRecord;
      syncStats.skippedDeepSync += 1;
      console.log(`Job ${jobId}: skipped deep sync (${skipDecision.reason})`);
      continue;
    }

    try {
      const jobDetail = await fetchJobDetail(client, job.id, authTimeoutMs);
      jobRecord.rawJobDetail = jobDetail;
      jobRecord.trainFiles = extractTrainFiles(jobDetail);
      console.log(`Job ${jobId}: fetched detail`);
    } catch (error) {
      jobRecord.code = { error: error instanceof Error ? error.message : String(error) };
      console.log(`Job ${jobId}: code files failed: ${error}`);
      syncStats.failedDeepFetch += 1;
    }

    const instances = await fetchJobInstances(client, jobId, pageSize, authTimeoutMs);
    console.log(`Job ${jobId}: ${instances.length} instances`);

    for (const instance of instances) {
      const instanceId = instance.id;
      if (!instanceId) continue;

      try {
        const [output, logResponse] = await Promise.all([
          fetchInstanceOutput(client, instanceId, authTimeoutMs),
          fetchInstanceLog(client, instanceId, authTimeoutMs),
        ]);
        const logDir = path.join(outDir, "logs", jobId);
        await mkdir(logDir, { recursive: true });
        const lines = normalizeLogLines(logResponse);
        await writeFile(path.join(logDir, `${instanceId}.json`), JSON.stringify(logResponse, null, 2), "utf8");
        await writeFile(path.join(logDir, `${instanceId}.txt`), lines.join("\n"), "utf8");

        jobRecord.instancesById[instanceId] = {
          ...(jobRecord.instancesById[instanceId] ?? {}),
          instanceId,
          rawInstance: instance,
          ...output,
          log: { path: `logs/${jobId}/${instanceId}.txt`, lines: lines.length },
          error: null,
        };
        const metricCount = Object.keys(output.metrics ?? {}).length;
        console.log(`  Instance ${instanceId}: ${metricCount} metrics, ${lines.length} log lines`);
      } catch (error) {
        jobRecord.instancesById[instanceId] = {
          ...(jobRecord.instancesById[instanceId] ?? {}),
          instanceId,
          rawInstance: instance,
          error: error instanceof Error ? error.message : String(error),
        };
        console.log(`  Instance ${instanceId}: failed: ${error}`);
        syncStats.failedDeepFetch += 1;
      }
    }

    jobRecord.sync = { skippedDeepSync: false, lastSeenAt: syncStartedAt, lastDeepFetchedAt: syncStartedAt };
    syncStats.deepFetched += 1;
    jobsById[jobId] = jobRecord;
  }

  const result = {
    sourceUrl: TRAINING_URL,
    fetchedAt: new Date().toISOString(),
    syncMode: opts.incremental ? "incremental" : "full",
    syncStats,
    jobsById,
  };

  // Aggregate metrics and checkpoints
  const metricRows: any[] = [];
  const checkpointRows: any[] = [];
  for (const j of Object.values(jobsById) as any[]) {
    for (const inst of Object.values(j.instancesById ?? {})) {
      for (const [metricName, metricPayload] of Object.entries((inst as any).metrics ?? {})) {
        const rows = normalizeMetricRowsForExport(metricName, metricPayload);
        for (const row of rows) {
          metricRows.push({ jobId: j.jobId, jobInternalId: j.jobInternalId, jobName: j.name, instanceId: (inst as any).instanceId, ...row });
        }
      }
      const ckpts = Array.isArray((inst as any).checkpoints) ? (inst as any).checkpoints : [];
      for (const ckpt of ckpts) {
        checkpointRows.push({
          jobId: j.jobId, jobInternalId: j.jobInternalId, jobName: j.name,
          instanceId: (inst as any).instanceId,
          ckpt: ckpt.ckpt, ckptFileSize: ckpt.ckpt_file_size,
          createTime: ckpt.create_time, deleteTime: ckpt.deleteTime, status: ckpt.status,
        });
      }
    }
  }

  await writeFile(jobsFile, JSON.stringify(result, null, 2), "utf8");
  await writeFile(path.join(outDir, "all-metrics-long.csv"), toCsv(metricRows), "utf8");
  await writeFile(path.join(outDir, "all-checkpoints.csv"), toCsv(checkpointRows), "utf8");
  await writeFile(path.join(outDir, "jobs-summary.csv"), toCsv(Object.values(jobsById).map((j: any) => ({
    jobId: j.jobId, jobInternalId: j.jobInternalId, name: j.name, description: j.description,
    status: j.status, jzStatus: j.jzStatus, updateTime: j.updateTime,
    syncMode: j.sync?.skippedDeepSync ? "skipped" : "deep",
    lastSeenAt: j.sync?.lastSeenAt, lastDeepFetchedAt: j.sync?.lastDeepFetchedAt,
    instances: Object.keys(j.instancesById ?? {}).length,
  }))), "utf8");

  console.log(`Saved ${Object.keys(jobsById).length} jobs, ${metricRows.length} metric points, ${checkpointRows.length} checkpoints to ${outDir}`);
}

function normalizeMetricRowsForExport(metricName: string, payload: unknown): any[] {
  if (!payload) return [];
  const arr = Array.isArray(payload) ? payload : [payload];
  return arr.flatMap((p: any, i: number) => {
    const dates = Array.isArray(p?.date) ? p.date : [];
    const titles = Array.isArray(p?.title) ? p.title : [];
    const values = Array.isArray(p?.value) ? p.value : [];
    const chartName = p?.name ?? p?.tag ?? titles.join("|") ?? `${metricName}_${i}`;
    const rows: any[] = [];
    for (let si = 0; si < Math.max(titles.length, values.length); si++) {
      const seriesName = titles[si] ?? `${metricName}_${si}`;
      const seriesValues = Array.isArray(values[si]) ? values[si] : [];
      for (let pi = 0; pi < seriesValues.length; pi++) {
        rows.push({ metric: metricName, chart: chartName, chartIndex: i, series: seriesName, step: dates[pi] ?? pi, value: seriesValues[pi] });
      }
    }
    return rows;
  });
}

function extractTrainFiles(jobDetail: any): any[] {
  const data = jobDetail?.data ?? jobDetail;
  const files = data?.trainFiles ?? data?.train_files ?? [];
  return Array.isArray(files) ? files : [];
}

function filterJobsForArgs(jobs: any[], opts: any): any[] {
  if (opts.jobInternalId) return jobs.filter((job) => String(job.id ?? "") === String(opts.jobInternalId));
  if (opts.jobId) return jobs.filter((job) => String(job.taskID ?? "") === String(opts.jobId));
  return jobs;
}
