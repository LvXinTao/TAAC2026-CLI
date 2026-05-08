import { Command } from "commander";
import { createReadStream } from "node:fs";
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

function inferInternalId(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const numericParts = parsed.pathname.split("/").filter((p) => /^\d{4,}$/.test(p));
    return numericParts[0] || "";
  } catch {
    return "";
  }
}

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
  const files = manifest.files as Record<string, unknown>;
  const codeZip = (files.codeZip as { preparedPath?: string } | undefined)?.preparedPath ? path.resolve(bundleDir, (files.codeZip as { preparedPath: string }).preparedPath) : null;
  const config = (files.config as { preparedPath?: string } | undefined)?.preparedPath ? path.resolve(bundleDir, (files.config as { preparedPath: string }).preparedPath) : null;
  const runSh = (files.runSh as { preparedPath?: string } | undefined)?.preparedPath ? path.resolve(bundleDir, (files.runSh as { preparedPath: string }).preparedPath) : null;
  const genericFiles = ((files.genericFiles as Array<{ name: string; preparedPath: string }> | undefined) ?? []).map((f) => ({
    name: f.name, path: path.resolve(bundleDir, f.preparedPath),
  }));
  return { manifest, codeZip, config, runSh, genericFiles };
}

async function fileMeta(filePath: string) {
  const s = await stat(filePath);
  return { bytes: s.size, basename: path.basename(filePath) };
}

function formatTaijiTime(date = new Date()): string {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const bj = new Date(utc + 8 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
}

function inferCosPrefix(trainFiles: Array<{ path: string }>): string {
  for (const file of trainFiles || []) {
    const match = String(file.path || "").match(/^(.+?)\/(?:common\/)?(?:train|template)\//);
    if (match) return match[1];
  }
  throw new Error("Cannot infer COS prefix from template trainFiles");
}

function newCosKey(prefix: string, filename: string): string {
  return `${prefix}/train/local--${randomUUID().replaceAll("-", "")}/${filename}`;
}

function contentTypeForTrainFile(name: string): string {
  if (name.endsWith(".zip")) return "application/x-zip-compressed";
  if (name.endsWith(".sh")) return "text/x-shellscript";
  if (name.endsWith(".py")) return "text/x-python";
  return "";
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

async function uploadToCos(cookieHeader: string, localPath: string, key: string, contentType: string) {
  const token = await getFederationToken(cookieHeader);
  const s = await stat(localPath);
  const cos = new COS({
    SecretId: token.id, SecretKey: token.key, SecurityToken: token.Token,
  });
  await putObject(cos, {
    Bucket: BUCKET, Region: REGION, Key: key,
    Body: createReadStream(localPath), ContentLength: s.size, ContentType: contentType,
  });
  return { key, bytes: s.size };
}

function replaceTrainFiles(
  templateFiles: Array<Record<string, string>>,
  uploaded: Array<Record<string, unknown>>,
) {
  const byName = new Map(uploaded.map((f) => [f.name, f]));
  const next: Array<Record<string, unknown>> = [];
  const matchedNames = new Set<string>();
  for (const file of templateFiles || []) {
    if (byName.has(file.name)) { next.push(byName.get(file.name)!); matchedNames.add(file.name); }
    else { next.push(file); }
  }
  const missing = uploaded.filter((f: Record<string, unknown>) => !matchedNames.has(f.name as string));
  if (missing.length) {
    throw new Error(`Template trainFiles does not contain required file: ${missing.map((f) => f.name).join(", ")}`);
  }
  return next;
}

function buildTaskPayload(
  templateData: Record<string, unknown>,
  job: { name: string; description: string },
  uploadedTrainFiles: Array<Record<string, unknown>>,
) {
  return {
    ...templateData,
    name: job.name,
    description: job.description,
    trainFiles: replaceTrainFiles((templateData.trainFiles as Array<Record<string, string>>) || [], uploadedTrainFiles),
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
    .description("Upload bundle to COS and create job")
    .requiredOption("--bundle <dir>", "Prepared bundle directory")
    .option("--run", "Start job after creation", false)
    .option("--yes", "Skip confirmation prompt", false)
    .option("--dry-run", "Preview without uploading", false)
    .option("--output <dir>", "Output directory for plan/result")
    .action(async (opts) => {
      const bundleDir = path.resolve(opts.bundle);
      const defaultOut = path.join("submit-live", new Date().toISOString().replace(/[:.]/g, "-"));
      const outDir = resolveTaijiOutputDir(opts.output ?? defaultOut);
      const { manifest, codeZip, config, runSh, genericFiles } = await loadBundle(bundleDir);

      // Template info from manifest only
      const templateJobUrl = manifest.templateJobUrl as string;
      const templateJobInternalId = inferInternalId(templateJobUrl);
      if (!templateJobInternalId) throw new Error("Cannot determine template job ID from manifest. Run `prepare` again with a valid `--template-id`.");

      // Job name/description from manifest only
      const jobRecord = (manifest.job as Record<string, string> | undefined) ?? {};
      const jobName = jobRecord.name;
      if (!jobName) throw new Error("Missing job.name in bundle manifest. Run `prepare` again with a valid `--name`.");
      const jobDescription = jobRecord.description ?? "";
      const job = { name: jobName, description: jobDescription };

      // File metadata
      const [zipMeta, configMeta, runShMeta, genericFileMetas] = await Promise.all([
        codeZip ? fileMeta(codeZip) : null,
        config ? fileMeta(config) : null,
        runSh ? fileMeta(runSh) : null,
        Promise.all(genericFiles.map(async (f) => ({ ...f, ...(await fileMeta(f.path)) }))),
      ]);

      const mode = opts.dryRun ? "dry-run" : "execute";

      // Safety check: require --yes for live execution
      if (!opts.dryRun && !opts.yes) {
        throw new Error("--dry-run is not set; add --yes to confirm live execution");
      }

      const plan = {
        mode,
        templateJobUrl, templateJobInternalId,
        runAfterSubmit: Boolean(opts.run),
        job,
        files: {
          ...(codeZip ? { codeZip: { path: codeZip, ...zipMeta } } : {}),
          ...(config ? { config: { path: config, ...configMeta } } : {}),
          ...(runSh ? { runSh: { path: runSh, ...runShMeta } } : {}),
          ...(genericFileMetas.length ? { genericFiles: genericFileMetas } : {}),
        },
      };

      // Auth
      const cookieHeader = await ensureCliAuth();
      const client = { directCookieHeader: cookieHeader };

      // Fetch template and build payload
      const template = await fetchJson(cookieHeader, `/taskmanagement/api/v1/webtasks/external/task/${templateJobInternalId}`);
      const templateData = template.data as Record<string, unknown>;
      if (!(templateData as Record<string, unknown> | undefined)?.trainFiles) throw new Error("Template has no data.trainFiles");
      const cosPrefix = inferCosPrefix(templateData.trainFiles as Array<{ path: string }>);

      let accountPrefix = "";
      const rawTaskId = String((templateData as Record<string, unknown>).taskId || "");
      const parts = rawTaskId.split("_");
      const amsIdx = parts.findIndex((p) => p === "ams");
      if (amsIdx >= 0 && amsIdx + 2 < parts.length) {
        accountPrefix = parts.slice(amsIdx, amsIdx + 3).join("_");
      }
      const fullCosPrefix = accountPrefix ? `${cosPrefix}/${accountPrefix}` : cosPrefix;

      const codeKey = codeZip ? newCosKey(fullCosPrefix, zipMeta!.basename) : null;
      const configKey = config ? newCosKey(fullCosPrefix, configMeta!.basename) : null;
      const uploadedTrainFiles = [
        ...(codeZip ? [{ name: "code.zip", path: codeKey!, mtime: formatTaijiTime(), size: zipMeta!.bytes }] : []),
        ...(config ? [{ name: "config.yaml", path: configKey!, mtime: formatTaijiTime(), size: configMeta!.bytes }] : []),
        ...(runSh ? [{ name: "run.sh", path: newCosKey(fullCosPrefix, runShMeta!.basename), mtime: formatTaijiTime(), size: runShMeta!.bytes }] : []),
        ...genericFileMetas.map((f) => ({ name: f.name, path: newCosKey(fullCosPrefix, f.name), mtime: formatTaijiTime(), size: f.bytes })),
      ];
      const taskPayload = buildTaskPayload(templateData, job, uploadedTrainFiles);
      const networkPlan = { ...plan, cosPrefix, uploadedTrainFiles, taskPayloadPreview: safeResult(taskPayload) };

      // Write plan.json
      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "plan.json"), `${JSON.stringify(networkPlan, null, 2)}\n`, "utf8");

      if (opts.dryRun) {
        console.log(`Wrote dry-run plan: ${path.join(outDir, "plan.json")}`);
        console.log("No upload/create/start happened. Remove --dry-run and add --yes to run live.");
        return;
      }

      // Execute live
      const uploadResults: Array<{ key: string; bytes: number }> = [];
      if (codeZip) uploadResults.push(await uploadToCos(cookieHeader, codeZip, codeKey!, "application/x-zip-compressed"));
      if (config) uploadResults.push(await uploadToCos(cookieHeader, config, configKey!, ""));
      if (runSh) {
        const runShFile = uploadedTrainFiles.find((f) => f.name === "run.sh");
        uploadResults.push(await uploadToCos(cookieHeader, runSh, runShFile!.path, "text/x-shellscript"));
      }
      for (const f of genericFileMetas) {
        const uploadedFile = uploadedTrainFiles.find((c) => c.name === f.name);
        uploadResults.push(await uploadToCos(cookieHeader, f.path, uploadedFile!.path, contentTypeForTrainFile(f.name)));
      }
      const created = await fetchJson(cookieHeader, "/taskmanagement/api/v1/webtasks/external/task", { method: "POST", body: taskPayload });
      const data = (created as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const taskId = data?.taskId;
      if (!taskId) throw new Error("Created task response has no data.taskId");

      let startResponse = null;
      if (opts.run) {
        startResponse = await fetchJson(cookieHeader, `/taskmanagement/api/v1/webtasks/${taskId}/start`, { method: "POST", body: {} });
      }
      const instances = await fetchJson(cookieHeader, "/taskmanagement/api/v1/instances/list", {
        method: "POST", body: { desc: true, orderBy: "create", task_id: taskId, page: 0, size: 10 },
      });

      const result = { ...networkPlan, uploadResults, created: safeResult(created), startResponse: safeResult(startResponse), instances: safeResult(instances), jobUrl: `${TAIJI_ORIGIN}/training`, taskId };
      await writeFile(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(`Created Taiji job: ${taskId}`);
      console.log(`Wrote live result: ${path.join(outDir, "result.json")}`);
    });
}
