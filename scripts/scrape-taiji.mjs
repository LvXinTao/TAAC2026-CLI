import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DEFAULT_URL =
  "https://taiji.algo.qq.com/training/ckpt/angel_training_ams_2026_1029735554728157691_20260505053802_1b5f3f87/56737/95cdb55f9de411b5019df4ed57762755";
const TRAINING_URL = "https://taiji.algo.qq.com/training";
const DEFAULT_API_AUTH_WAIT_MS = 180_000;
const DEFAULT_OUT_ROOT = "taiji-output";

const METRIC_SAFE_NAME = /[^a-zA-Z0-9._-]+/g;

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    all: false,
    outDir: DEFAULT_OUT_ROOT,
    headless: false,
    incremental: false,
    timeoutMs: 120_000,
    pageSize: 100,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--url" && argv[i + 1]) args.url = argv[++i];
    else if (arg === "--all") {
      args.all = true;
      args.url = TRAINING_URL;
    }
    else if (arg === "--out" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg === "--cookie-file" && argv[i + 1]) args.cookieFile = argv[++i];
    else if (arg === "--direct") args.direct = true;
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--incremental") args.incremental = true;
    else if (arg === "--timeout" && argv[i + 1]) args.timeoutMs = Number(argv[++i]);
    else if (arg === "--auth-timeout" && argv[i + 1]) args.authTimeoutMs = Number(argv[++i]);
    else if (arg === "--page-size" && argv[i + 1]) args.pageSize = Number(argv[++i]);
    else if (!arg.startsWith("--")) args.url = arg;
  }

  args.authTimeoutMs ??= Math.max(args.timeoutMs, DEFAULT_API_AUTH_WAIT_MS);

  return args;
}

function assertSafeRelativeOutputPath(outDir) {
  if (!path.isAbsolute(outDir) && String(outDir).split(/[\\/]+/).includes("..")) {
    throw new Error("Relative output paths must not contain '..'. Use an absolute path for custom locations outside taiji-output.");
  }
}

export function resolveTaijiOutputDir(outDir) {
  assertSafeRelativeOutputPath(outDir);
  if (path.isAbsolute(outDir)) return outDir;
  if (outDir.split(/[\\/]/)[0] === DEFAULT_OUT_ROOT) return path.resolve(outDir);
  return path.resolve(DEFAULT_OUT_ROOT, outDir);
}

function extractCookieHeader(fileContent) {
  const text = fileContent.trim();
  const headerLine = text.match(/^cookie:\s*(.+)$/im);
  if (headerLine) return headerLine[1].trim();

  const curlHeader = text.match(/(?:-H|--header)\s+(['"])cookie:\s*([\s\S]*?)\1/i);
  if (curlHeader) return curlHeader[2].trim();

  return text.replace(/^cookie:\s*/i, "").trim();
}

function parseCookieHeader(fileContent) {
  const cookieHeader = extractCookieHeader(fileContent);
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return null;
      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!name) return null;
      return {
        name,
        value,
        domain: ".taiji.algo.qq.com",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax",
      };
    })
    .filter(Boolean);
}

async function addCookiesFromFile(context, cookieFile) {
  if (!cookieFile) return;
  const cookiePath = path.resolve(cookieFile);
  const cookieHeader = (await readFile(cookiePath, "utf8")).trim();
  const cookies = parseCookieHeader(cookieHeader);
  if (!cookies.length) throw new Error(`No cookies parsed from ${cookiePath}`);
  await context.addCookies(cookies);
  console.log(`Loaded ${cookies.length} cookies from ${cookiePath}`);
}

async function createDirectClient(cookieFile) {
  if (!cookieFile) throw new Error("--direct requires --cookie-file");
  const cookiePath = path.resolve(cookieFile);
  const cookieHeader = extractCookieHeader(await readFile(cookiePath, "utf8"));
  if (!cookieHeader) throw new Error(`No cookie header parsed from ${cookiePath}`);
  console.log(`Loaded cookie header from ${cookiePath}`);
  return { directCookieHeader: cookieHeader };
}

function isDirectClient(client) {
  return Boolean(client?.directCookieHeader);
}

function getInstanceId(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const instanceId = parts.at(-1);
  if (!instanceId) throw new Error(`Cannot parse instanceId from URL: ${url}`);
  return instanceId;
}

function csvEscape(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.map(csvEscape).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

function normalizeLogLines(logResponse) {
  const data = logResponse?.data ?? logResponse;
  if (Array.isArray(data)) return data.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  if (typeof data === "string") return data.split(/\r?\n/);
  if (Array.isArray(data?.list)) return data.list.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  if (Array.isArray(data?.logs)) return data.logs.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  return [];
}

function safePathPart(value) {
  return String(value ?? "unknown").replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_").slice(0, 180);
}

function safeRelativeFilePath(file) {
  const raw = String(file?.name ?? file?.path ?? file?.url ?? "file");
  const withoutProtocol = raw.replace(/^https?:\/\//i, "").replace(/^\/+/, "");
  const parts = withoutProtocol.split(/[\\/]+/).filter(Boolean).map(safePathPart);
  return parts.length ? path.join(...parts) : "file";
}

function normalizeMetricRows(metricName, metricPayload) {
  if (!metricPayload) return [];

  if (Array.isArray(metricPayload)) {
    return metricPayload.flatMap((payload, chartIndex) => normalizeMetricChartRows(metricName, payload, chartIndex));
  }

  return normalizeMetricChartRows(metricName, metricPayload, 0);
}

function normalizeMetricChartRows(metricName, metricPayload, chartIndex) {
  const dates = Array.isArray(metricPayload.date) ? metricPayload.date : [];
  const titles = Array.isArray(metricPayload.title) ? metricPayload.title : [];
  const values = Array.isArray(metricPayload.value) ? metricPayload.value : [];
  const rows = [];
  const chartName = metricPayload.name ?? metricPayload.tag ?? titles.join("|") ?? `${metricName}_${chartIndex}`;

  for (let seriesIndex = 0; seriesIndex < Math.max(titles.length, values.length); seriesIndex += 1) {
    const seriesName = titles[seriesIndex] ?? `${metricName}_${seriesIndex}`;
    const seriesValues = Array.isArray(values[seriesIndex]) ? values[seriesIndex] : [];

    for (let pointIndex = 0; pointIndex < seriesValues.length; pointIndex += 1) {
      rows.push({
        metric: metricName,
        chart: chartName,
        chartIndex,
        series: seriesName,
        step: dates[pointIndex] ?? pointIndex,
        value: seriesValues[pointIndex],
      });
    }
  }

  return rows;
}

function summarizeMetrics(metrics) {
  return Object.fromEntries(
    Object.entries(metrics).map(([name, payload]) => {
      const rows = normalizeMetricRows(name, payload);
      const numericValues = rows.map((row) => Number(row.value)).filter(Number.isFinite);
      const last = rows.at(-1);
      return [
        name,
        {
          series: [...new Set(rows.map((row) => row.series))],
          charts: [...new Set(rows.map((row) => row.chart))],
          points: rows.length,
          firstStep: rows[0]?.step ?? null,
          lastStep: last?.step ?? null,
          lastValue: last?.value ?? null,
          min: numericValues.length ? Math.min(...numericValues) : null,
          max: numericValues.length ? Math.max(...numericValues) : null,
        },
      ];
    }),
  );
}

function isTerminalJob(job) {
  const status = String(job?.status ?? "").toUpperCase();
  const jzStatus = String(job?.jzStatus ?? "").toUpperCase();
  return jzStatus === "END" || ["SUCCEED", "FAILED", "KILLED", "CANCELED", "CANCELLED"].includes(status);
}

function hasCompleteCachedDeepSync(current) {
  if (!current) return false;
  if (!current.code || current.code.error) return false;
  const instances = Object.values(current.instancesById ?? {});
  if (!instances.length) return false;
  return instances.every((instance) => !instance?.error);
}

export function shouldSkipJobDeepSync(current, listedJob, options = {}) {
  if (!options.incremental) return { skip: false, reason: "incremental_disabled" };
  if (!current) return { skip: false, reason: "new_job" };
  if (!hasCompleteCachedDeepSync(current)) return { skip: false, reason: "incomplete_cached_job" };
  if (!isTerminalJob(listedJob)) return { skip: false, reason: "non_terminal_job" };
  if (current.updateTime !== listedJob.updateTime) return { skip: false, reason: "update_time_changed" };
  if ((current.status ?? "") !== (listedJob.status ?? current.status ?? "")) return { skip: false, reason: "status_changed" };
  if ((current.jzStatus ?? "") !== (listedJob.jzStatus ?? current.jzStatus ?? "")) return { skip: false, reason: "jz_status_changed" };
  return { skip: true, reason: "unchanged_terminal_job" };
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchJsonFromPage(page, endpoint, options = {}) {
  if (isDirectClient(page)) return fetchJsonDirect(page, endpoint, options);

  const deadline = Date.now() + (options.authWaitMs ?? DEFAULT_API_AUTH_WAIT_MS);

  for (;;) {
    let result;
    try {
      result = await page.evaluate(async ({ apiPath, method, params }) => {
        const url = new URL(apiPath, "https://taiji.algo.qq.com");
        const requestInit = {
          method,
          credentials: "include",
          headers: { accept: "application/json, text/plain, */*" },
        };

        if (method === "GET") {
          for (const [key, value] of Object.entries(params ?? {})) {
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
          }
        } else {
          requestInit.headers["content-type"] = "application/json";
          requestInit.body = JSON.stringify(params ?? {});
        }

        const response = await fetch(url.href, requestInit);

        const text = await response.text();
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          text,
          body,
        };
      }, { apiPath: endpoint, method: options.method ?? "GET", params: options.params ?? {} });
    } catch (error) {
      if (Date.now() < deadline) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`API ${endpoint} is not reachable yet (${message}). Finish login in the opened browser; retrying...`);
        await page.waitForTimeout(5_000);
        continue;
      }
      throw error;
    }

    if (result.ok) return result.body;

    if ([401, 403].includes(result.status) && Date.now() < deadline) {
      console.log(`API ${endpoint} returned ${result.status}. Log in or refresh auth in the opened browser; retrying...`);
      await page.waitForTimeout(5_000);
      continue;
    }

    throw new Error(`HTTP ${result.status} ${result.statusText}: ${String(result.text).slice(0, 500)}`);
  }
}

async function fetchJsonDirect(client, endpoint, options = {}) {
  const url = new URL(endpoint, "https://taiji.algo.qq.com");
  const method = options.method ?? "GET";
  const headers = {
    accept: "application/json, text/plain, */*",
    cookie: client.directCookieHeader,
    referer: TRAINING_URL,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
  };
  const requestInit = { method, headers };

  if (method === "GET") {
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
  } else {
    headers["content-type"] = "application/json";
    requestInit.body = JSON.stringify(options.params ?? {});
  }

  const response = await fetch(url, requestInit);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }

  return body;
}

async function waitForLogin(page, url, timeoutMs, expectedTexts) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pages = page.context().pages();
    const activePage = pages.find((candidate) => candidate.url().includes("taiji.algo.qq.com")) ?? page;
    if (activePage !== page) page = activePage;

    const location = page.url();
    const bodyText = await page.locator("body").textContent({ timeout: 1_000 }).catch(() => "");
    const hasAppContent = expectedTexts.some((text) => bodyText?.includes(text));
    if (location.includes("taiji.algo.qq.com") && hasAppContent) return;

    console.log("Waiting for TAAC page/login to finish...");
    await page.waitForTimeout(3_000);
  }

  throw new Error("Timed out waiting for TAAC page. If login is required, finish login in the opened browser window.");
}

function extractRows(response) {
  const data = response?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(response?.list)) return response.list;
  return [];
}

function extractTotal(response) {
  return (
    response?.data?.totalCount ??
    response?.data?.total ??
    response?.data?.count ??
    response?.totalCount ??
    response?.total ??
    null
  );
}

async function fetchTrainingJobs(page, pageSize, authWaitMs) {
  const jobs = [];
  for (let pageNum = 0; ; pageNum += 1) {
    const response = await fetchJsonFromPage(page, "/taskmanagement/api/v1/webtasks/external/task", {
      params: { pageNum, pageSize },
      authWaitMs,
    });
    const rows = extractRows(response);
    jobs.push(...rows);

    const total = extractTotal(response);
    if (!rows.length || rows.length < pageSize || (total != null && jobs.length >= total)) break;
  }
  return jobs;
}

async function fetchJobInstances(page, taskID, pageSize, authWaitMs) {
  const instances = [];
  for (let pageNum = 0; ; pageNum += 1) {
    const response = await fetchJsonFromPage(page, "/taskmanagement/api/v1/instances/list", {
      method: "POST",
      params: {
        desc: true,
        orderBy: "create",
        task_id: taskID,
        page: pageNum,
        size: pageSize,
      },
      authWaitMs,
    });
    const rows = extractRows(response);
    instances.push(...rows);

    const total = extractTotal(response);
    if (!rows.length || rows.length < pageSize || (total != null && instances.length >= total)) break;
  }
  return instances;
}

async function fetchInstanceOutput(page, instanceId, authWaitMs) {
  const [checkpoints, tfEvents] = await Promise.all([
    fetchJsonFromPage(page, `/taskmanagement/api/v1/instances/external/${instanceId}/get_ckpt`, { authWaitMs }),
    fetchJsonFromPage(page, `/taskmanagement/api/v1/instances/external/${instanceId}/tf_events`, { authWaitMs }),
  ]);
  const metrics = tfEvents?.data?.data ?? {};
  return {
    rawResponses: { checkpoints, tfEvents },
    checkpoints: checkpoints?.data ?? checkpoints,
    metricOptions: tfEvents?.data?.options ?? [],
    metrics,
    metricSummary: summarizeMetrics(metrics),
  };
}

async function fetchInstanceLog(page, instanceId, authWaitMs) {
  return fetchJsonFromPage(page, `/taskmanagement/api/v1/instances/${instanceId}/pod_log`, { authWaitMs });
}

async function fetchJobDetail(page, jobInternalId, authWaitMs) {
  return fetchJsonFromPage(page, `/taskmanagement/api/v1/webtasks/external/task/${jobInternalId}`, { authWaitMs });
}

function extractTrainFiles(jobDetail) {
  const data = jobDetail?.data ?? jobDetail;
  const files = data?.trainFiles ?? data?.train_files ?? [];
  return Array.isArray(files) ? files : [];
}

async function fetchTextResource(page, resourceUrl, options = {}) {
  if (isDirectClient(page)) return fetchTextDirect(page, resourceUrl, options);

  const result = await page.evaluate(async ({ url }) => {
    const response = await fetch(url, {
      credentials: "include",
      headers: { accept: "*/*" },
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      text: await response.text(),
    };
  }, { url: resourceUrl });

  if (!result.ok) throw new Error(`HTTP ${result.status} ${result.statusText}`);
  return result;
}

export async function fetchTextDirect(client, resourceUrl) {
  const response = await fetch(resourceUrl, {
    headers: {
      accept: "*/*",
      cookie: client.directCookieHeader,
      referer: TRAINING_URL,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
    },
  });
  const result = {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    text: await response.text(),
  };
  if (!result.ok) throw new Error(`HTTP ${result.status} ${result.statusText}`);
  return result;
}

function candidateFileUrls(file) {
  const rawPath = file?.path ?? file?.url ?? "";
  if (!rawPath) return [];
  if (/^https?:\/\//i.test(rawPath)) return [rawPath];
  const trimmed = String(rawPath).replace(/^\/+/, "");
  return [`https://taiji.algo.qq.com/${trimmed}`];
}

function rowsForAllJobs(jobsById) {
  const metricRows = [];
  const checkpointRows = [];

  for (const job of Object.values(jobsById)) {
    for (const instance of Object.values(job.instancesById ?? {})) {
      for (const [metricName, metricPayload] of Object.entries(instance.metrics ?? {})) {
        for (const row of normalizeMetricRows(metricName, metricPayload)) {
          metricRows.push({
            jobId: job.jobId,
            jobInternalId: job.jobInternalId,
            jobName: job.name,
            instanceId: instance.instanceId,
            ...row,
          });
        }
      }

      const ckpts = Array.isArray(instance.checkpoints) ? instance.checkpoints : [];
      for (const ckpt of ckpts) {
        checkpointRows.push({
          jobId: job.jobId,
          jobInternalId: job.jobInternalId,
          jobName: job.name,
          instanceId: instance.instanceId,
          ckpt: ckpt.ckpt,
          ckptFileSize: ckpt.ckpt_file_size,
          createTime: ckpt.create_time,
          deleteTime: ckpt.deleteTime,
          status: ckpt.status,
        });
      }
    }
  }

  return { metricRows, checkpointRows };
}

async function scrapeSingleCkptPage(page, args, outputDir) {
  const instanceId = getInstanceId(args.url);
  if (!isDirectClient(page)) await waitForLogin(page, args.url, args.timeoutMs, ["Metrics", "指标", "Checkpoints", "产出ckpt列表"]);

  const instanceOutput = await fetchInstanceOutput(page, instanceId, args.authTimeoutMs);
  const metricNames = Object.keys(instanceOutput.metrics);
  const allMetricRows = metricNames.flatMap((name) => normalizeMetricRows(name, instanceOutput.metrics[name]));

  const result = {
    sourceUrl: args.url,
    instanceId,
    fetchedAt: new Date().toISOString(),
    ...instanceOutput,
  };

  await writeFile(path.join(outputDir, "taiji-result.json"), JSON.stringify(result, null, 2), "utf8");
  await writeFile(path.join(outputDir, "metrics-long.csv"), toCsv(allMetricRows), "utf8");
  await writeFile(path.join(outputDir, "metric-summary.json"), JSON.stringify(result.metricSummary, null, 2), "utf8");

  for (const name of metricNames) {
    const safeName = name.replace(METRIC_SAFE_NAME, "_");
    await writeFile(path.join(outputDir, `metric-${safeName}.csv`), toCsv(normalizeMetricRows(name, result.metrics[name])), "utf8");
  }

  console.log(`Saved ${metricNames.length} metrics and ${allMetricRows.length} points to ${outputDir}`);
  console.log(`Metrics: ${metricNames.join(", ") || "(none)"}`);
}

async function saveInstanceLog(outputDir, jobId, instanceId, logResponse) {
  const logDir = path.join(outputDir, "logs", jobId);
  await mkdir(logDir, { recursive: true });
  const lines = normalizeLogLines(logResponse);
  await writeFile(path.join(logDir, `${instanceId}.json`), JSON.stringify(logResponse, null, 2), "utf8");
  await writeFile(path.join(logDir, `${instanceId}.txt`), lines.join("\n"), "utf8");
  return { path: path.join("logs", jobId, `${instanceId}.txt`), lines: lines.length };
}

async function saveJobCodeFiles(page, outputDir, jobId, jobDetail, authWaitMs) {
  const codeDir = path.join(outputDir, "code", jobId);
  await mkdir(codeDir, { recursive: true });
  await writeFile(path.join(codeDir, "job-detail.json"), JSON.stringify(jobDetail, null, 2), "utf8");

  const trainFiles = extractTrainFiles(jobDetail);
  const saved = [];

  for (const file of trainFiles) {
    const name = file.name ?? path.basename(file.path ?? file.url ?? "file");
    const relativeFilePath = safeRelativeFilePath(file);
    const meta = { name, path: file.path ?? file.url ?? "", size: file.size, mtime: file.mtime };
    let lastError = "";

    for (const url of candidateFileUrls(file)) {
      try {
        const response = await fetchTextResource(page, url, { authWaitMs });
        const relativePath = path.join("code", jobId, "files", relativeFilePath);
        await mkdir(path.dirname(path.join(outputDir, relativePath)), { recursive: true });
        await writeFile(path.join(outputDir, relativePath), response.text, "utf8");
        saved.push({ ...meta, saved: true, relativePath, url, contentType: response.contentType });
        lastError = "";
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (lastError) saved.push({ ...meta, saved: false, error: lastError });
  }

  await writeFile(path.join(codeDir, "train-files.json"), JSON.stringify({ trainFiles, saved }, null, 2), "utf8");
  return { path: path.join("code", jobId), files: trainFiles.length, saved: saved.filter((file) => file.saved).length };
}

async function scrapeAllTrainingJobs(page, args, outputDir) {
  if (!isDirectClient(page)) await waitForLogin(page, TRAINING_URL, args.timeoutMs, ["Model Training Job", "模型训练任务", "Job ID", "任务ID"]);

  const jobsFile = path.join(outputDir, "jobs.json");
  const existing = await readJsonIfExists(jobsFile, { jobsById: {} });
  const jobsById = existing.jobsById ?? {};
  const jobs = await fetchTrainingJobs(page, args.pageSize, args.authTimeoutMs);
  const syncStartedAt = new Date().toISOString();
  const syncStats = { jobsListed: jobs.length, deepFetched: 0, skippedDeepSync: 0, failedDeepFetch: 0 };

  console.log(`Found ${jobs.length} jobs`);

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

    const skipDecision = shouldSkipJobDeepSync(current, job, { incremental: args.incremental });
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
      const jobDetail = await fetchJobDetail(page, job.id, args.authTimeoutMs);
      const code = await saveJobCodeFiles(page, outputDir, jobId, jobDetail, args.authTimeoutMs);
      jobRecord.rawJobDetail = jobDetail;
      jobRecord.trainFiles = extractTrainFiles(jobDetail);
      jobRecord.code = code;
      console.log(`Job ${jobId}: ${code.files} code files, ${code.saved} saved`);
    } catch (error) {
      jobRecord.code = { error: error instanceof Error ? error.message : String(error) };
      console.log(`Job ${jobId}: code files failed: ${error}`);
      syncStats.failedDeepFetch += 1;
    }

    const instances = await fetchJobInstances(page, jobId, args.pageSize, args.authTimeoutMs);
    console.log(`Job ${jobId}: ${instances.length} instances`);

    for (const instance of instances) {
      const instanceId = instance.id;
      if (!instanceId) continue;

      try {
        const [output, logResponse] = await Promise.all([
          fetchInstanceOutput(page, instanceId, args.authTimeoutMs),
          fetchInstanceLog(page, instanceId, args.authTimeoutMs),
        ]);
        const logInfo = await saveInstanceLog(outputDir, jobId, instanceId, logResponse);
        jobRecord.instancesById[instanceId] = {
          ...(jobRecord.instancesById[instanceId] ?? {}),
          instanceId,
          rawInstance: instance,
          ...output,
          log: logInfo,
          error: null,
        };
        const metricCount = Object.keys(output.metrics).length;
        console.log(`  Instance ${instanceId}: ${metricCount} metrics, ${logInfo.lines} log lines`);
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

    jobRecord.sync = {
      skippedDeepSync: false,
      lastSeenAt: syncStartedAt,
      lastDeepFetchedAt: syncStartedAt,
    };
    syncStats.deepFetched += 1;

    jobsById[jobId] = jobRecord;
  }

  const result = {
    sourceUrl: TRAINING_URL,
    fetchedAt: new Date().toISOString(),
    syncMode: args.incremental ? "incremental" : "full",
    syncStats,
    jobsById,
  };
  const { metricRows, checkpointRows } = rowsForAllJobs(jobsById);

  await writeFile(jobsFile, JSON.stringify(result, null, 2), "utf8");
  await writeFile(path.join(outputDir, "all-metrics-long.csv"), toCsv(metricRows), "utf8");
  await writeFile(path.join(outputDir, "all-checkpoints.csv"), toCsv(checkpointRows), "utf8");
  await writeFile(path.join(outputDir, "jobs-summary.csv"), toCsv(Object.values(jobsById).map((job) => ({
    jobId: job.jobId,
    jobInternalId: job.jobInternalId,
    name: job.name,
    description: job.description,
    status: job.status,
    jzStatus: job.jzStatus,
    updateTime: job.updateTime,
    syncMode: job.sync?.skippedDeepSync ? "skipped" : "deep",
    lastSeenAt: job.sync?.lastSeenAt,
    lastDeepFetchedAt: job.sync?.lastDeepFetchedAt,
    instances: Object.keys(job.instancesById ?? {}).length,
  }))), "utf8");

  console.log(
    `Saved ${Object.keys(jobsById).length} jobs, ${metricRows.length} metric points, ${checkpointRows.length} checkpoints to ${outputDir}`,
  );
  if (args.incremental) {
    console.log(`Incremental sync: deep_fetched=${syncStats.deepFetched}, skipped=${syncStats.skippedDeepSync}, failed=${syncStats.failedDeepFetch}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = resolveTaijiOutputDir(args.outDir);
  const userDataDir = path.resolve(outputDir, "browser-profile");

  await mkdir(outputDir, { recursive: true });

  if (args.direct) {
    const client = await createDirectClient(args.cookieFile);
    if (args.all) await scrapeAllTrainingJobs(client, args, outputDir);
    else await scrapeSingleCkptPage(client, args, outputDir);
    return;
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: args.headless,
    viewport: { width: 1600, height: 1000 },
  });

  try {
    await addCookiesFromFile(context, args.cookieFile);
    const page = context.pages()[0] ?? (await context.newPage());
    if (args.all) await scrapeAllTrainingJobs(page, args, outputDir);
    else await scrapeSingleCkptPage(page, args, outputDir);
  } finally {
    await context.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
