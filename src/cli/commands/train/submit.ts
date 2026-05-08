import { Command } from "commander";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const BUCKET = "hunyuan-external-1258344706";
const REGION = "ap-guangzhou";
const TAIJI_ORIGIN = "https://taiji.algo.qq.com";

function taijiHeaders(cookieHeader: string) {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    cookie: cookieHeader,
    referer: `${TAIJI_ORIGIN}/training/create`,
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147 Safari/537.36",
  };
}

async function fetchJson(cookieHeader: string, endpoint: string, options?: { method?: string; body?: unknown }) {
  const url = new URL(endpoint, TAIJI_ORIGIN);
  const init: Record<string, unknown> = { method: options?.method || "GET", headers: taijiHeaders(cookieHeader) };
  if (options?.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(url.href, init as RequestInit);
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url.pathname}: ${String(text).slice(0, 300)}`);
  return body as Record<string, unknown>;
}

async function loadBundle(bundleDir: string) {
  const manifest = JSON.parse(await readFile(path.join(bundleDir, "manifest.json"), "utf8")) as Record<string, unknown>;
  const files = manifest.files as Array<Record<string, string>> | undefined;
  if (!files || !Array.isArray(files)) {
    throw new Error("Invalid manifest: expected 'files' to be an array. Re-run `prepare` with the updated version.");
  }
  const entries = files.map((f) => ({
    name: f.name,
    localPath: path.resolve(bundleDir, f.preparedPath),
    isPrimary: f.isPrimary === "true",
  }));
  return { manifest, files: entries };
}

function findTaijiOutputDir(fromDir: string): string | null {
  let current = fromDir;
  while (true) {
    if (existsSync(path.join(current, "jobs.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveTemplateInternalId(manifest: Record<string, unknown>, bundleDir: string): string {
  const templateJobUrl = manifest.templateJobUrl as string | undefined;
  if (templateJobUrl) {
    const numericParts = new URL(templateJobUrl, TAIJI_ORIGIN).pathname.split("/").filter((p) => /^\d{4,}$/.test(p));
    if (numericParts[0]) return numericParts[0];
  }

  const templateJobId = manifest.templateJobId as string | undefined;
  if (!templateJobId) return "";
  if (/^\d+$/.test(templateJobId)) return templateJobId;

  const taijiOutputDir = findTaijiOutputDir(bundleDir);
  if (!taijiOutputDir) return "";
  try {
    const jobsData = JSON.parse(readFileSync(path.join(taijiOutputDir, "jobs.json"), "utf8"));
    const entry = jobsData.jobsById?.[templateJobId];
    if (entry?.jobInternalId) return String(entry.jobInternalId);
  } catch { /* not available */ }
  return "";
}

function formatTaijiTime(date = new Date()): string {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const bj = new Date(utc + 8 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
}

function inferCosPrefix(templateFiles: Array<{ path: string }>): string {
  for (const file of templateFiles) {
    const match = file.path.match(/^(.+?)\/(?:common\/)?(?:train|template)\//);
    if (match) return match[1];
  }
  throw new Error("Cannot infer COS prefix from template trainFiles");
}

function inferAccountPrefix(taskId: string): string {
  const parts = taskId.split("_");
  const amsIdx = parts.findIndex((p) => p === "ams");
  if (amsIdx >= 0 && amsIdx + 2 < parts.length) {
    return parts.slice(amsIdx, amsIdx + 3).join("_");
  }
  return "";
}

function newCosKey(prefix: string, filename: string): string {
  return `${prefix}/train/local--${randomUUID().replaceAll("-", "")}/${filename}`;
}

async function getFederationToken(cookieHeader: string) {
  const token = await fetchJson(cookieHeader, "/aide/api/evaluation_tasks/get_federation_token/");
  for (const key of ["id", "key", "Token"]) {
    if (!token?.[key]) throw new Error(`Federation token missing: ${key}`);
  }
  return token as Record<string, string>;
}

function putObject(cos: InstanceType<typeof COS>, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    cos.putObject(params, (error: Error | null, data: Record<string, unknown>) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

async function uploadToCos(cookieHeader: string, localPath: string, key: string) {
  const token = await getFederationToken(cookieHeader);
  const s = await stat(localPath);
  const cos = new COS({
    SecretId: token.id, SecretKey: token.key, SecurityToken: token.Token,
  });
  await putObject(cos, {
    Bucket: BUCKET, Region: REGION, Key: key,
    Body: createReadStream(localPath), ContentLength: s.size,
  });
  return { key, bytes: s.size };
}

interface CreatePayload {
  templateId: number;
  name: string;
  description: string;
  modelName: string;
  trainDataName: string;
  hostGpuNum: number;
  label: string;
  trainFiles: Array<{ name: string; path: string; mtime: string; size: number }>;
}

function buildCreatePayload(template: Record<string, unknown>, jobName: string, jobDescription: string, trainFiles: Array<{ name: string; path: string; mtime: string; size: number }>, gpuNum?: number): CreatePayload {
  return {
    templateId: template.templateId as number,
    name: jobName,
    description: jobDescription,
    modelName: (template.modelName as string) ?? "Baseline Model Name",
    trainDataName: (template.trainDataName as string) ?? "TencentGR",
    hostGpuNum: gpuNum ?? (template.hostGpuNum as number) ?? 1,
    label: (template.label as string) ?? "",
    trainFiles,
  };
}

function safeResult(result: unknown): unknown {
  return JSON.parse(JSON.stringify(result, (key, value) => {
    if (/cookie|token|secret|credential|authorization|signature/i.test(key)) return "<redacted>";
    return value;
  }));
}

export function registerTrainSubmitCommand(trainCmd: Command) {
  trainCmd
    .command("submit")
    .description("Upload bundle to COS and create a new training job. The template ID is read from the bundle manifest or --template-id.")
    .requiredOption("--bundle <dir>", "Prepared bundle directory")
    .option("--template-id <id>", "Template job ID — override the template ID from bundle manifest")
    .option("--gpu-num <n>", "Number of GPUs (default: from template)")
    .option("--yes", "Skip confirmation prompt", false)
    .option("--dry-run", "Preview without uploading", false)
    .option("--output <dir>", "Output directory for plan/result")
    .action(async (opts) => {
      const bundleDir = path.resolve(opts.bundle);
      const defaultOut = path.join("taiji-output", "submit-live", new Date().toISOString().replace(/[:.]/g, "-"));
      const outDir = resolveTaijiOutputDir(opts.output ?? defaultOut);
      const { manifest, files: bundleFiles } = await loadBundle(bundleDir);

      // Override manifest templateId with CLI option if provided
      if (opts.templateId) manifest.templateJobId = String(opts.templateId);

      // Resolve template internal ID
      const templateJobInternalId = resolveTemplateInternalId(manifest, bundleDir);
      if (!templateJobInternalId) throw new Error("Cannot determine template job ID. Provide --template-id or include it in the bundle manifest.");

      // Job name/description from manifest
      const jobRecord = (manifest.job as Record<string, string> | undefined) ?? {};
      if (!jobRecord.name) throw new Error("Missing job.name in bundle manifest. Run `prepare` again with a valid `--name`.");
      const job = { name: jobRecord.name, description: jobRecord.description ?? "" };

      // Auth
      const cookieHeader = await ensureCliAuth();

      // Fetch template to get templateId, trainDataName, modelName, hostGpuNum, and existing COS prefix
      const template = await fetchJson(cookieHeader, `/taskmanagement/api/v1/webtasks/external/task/${templateJobInternalId}`);
      const templateData = (template.data as Record<string, unknown>) ?? {};

      const templateFiles = ((templateData.trainFiles as Array<{ path: string }>) || []).map((f) => ({ path: f.path }));
      const cosPrefix = inferCosPrefix(templateFiles);
      const accountPrefix = inferAccountPrefix(String(templateData.taskId || ""));
      const fullCosPrefix = accountPrefix ? `${cosPrefix}/${accountPrefix}` : cosPrefix;

      // Build trainFiles entries for uploaded files
      const trainFiles = bundleFiles.map((f) => ({
        name: f.name,
        cosKey: newCosKey(fullCosPrefix, f.name),
        localPath: f.localPath,
        mtime: formatTaijiTime(),
        size: 0, // filled by stat below
      }));

      // Get file sizes
      for (const f of trainFiles) {
        const s = await stat(f.localPath);
        f.size = s.size;
      }

      const mode = opts.dryRun ? "dry-run" : "execute";

      // Safety check
      if (!opts.dryRun && !opts.yes) {
        throw new Error("--dry-run is not set; add --yes to confirm live execution");
      }

      const createPayload = buildCreatePayload(templateData, job.name, job.description, trainFiles.map((f) => ({
        name: f.name, path: f.cosKey, mtime: f.mtime, size: f.size,
      })), opts.gpuNum ? parseInt(opts.gpuNum, 10) : undefined);

      const plan = {
        mode,
        templateJobInternalId,
        job,
        cosPrefix: fullCosPrefix,
        uploadFiles: trainFiles.map((f) => ({ name: f.name, cosKey: f.cosKey, size: f.size })),
        createPayload: safeResult(createPayload) as Record<string, unknown>,
      };

      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");

      if (opts.dryRun) {
        console.log(`Wrote dry-run plan: ${path.join(outDir, "plan.json")}`);
        console.log("No upload/create/start happened. Remove --dry-run and add --yes to run live.");
        return;
      }

      // Execute: upload files to COS, then create job
      const uploadResults: Array<{ key: string; bytes: number }> = [];
      for (const f of trainFiles) {
        const result = await uploadToCos(cookieHeader, f.localPath, f.cosKey);
        uploadResults.push(result);
        console.log(`  Uploaded ${f.name} -> ${result.key}`);
      }

      const created = await fetchJson(cookieHeader, "/taskmanagement/api/v1/webtasks/external/task", { method: "POST", body: createPayload });
      const data = (created as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const taskId = data?.taskId;
      if (!taskId) throw new Error("Created task response has no data.taskId");

      const result = { ...plan, uploadResults, created: safeResult(created), taskId, jobUrl: `${TAIJI_ORIGIN}/training` };
      await writeFile(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(`Created Taiji job: ${taskId}`);
      console.log(`Wrote live result: ${path.join(outDir, "result.json")}`);
    });
}
