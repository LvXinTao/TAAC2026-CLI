import { Command } from "commander";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ensureAuthenticated, createDirectClient } from "../../../auth/token.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const BUCKET = "hunyuan-external-1258344706";
const REGION = "ap-guangzhou";
const TAIJI_ORIGIN = "https://taiji.algo.qq.com";

function extractCookieHeader(fileContent: string): string {
  const text = fileContent.trim();
  const headerLine = text.match(/^cookie:\s*(.+)$/im);
  if (headerLine) return headerLine[1].trim();
  const curlHeader = text.match(/(?:-H|--header)\s+(['"])cookie:\s*([\s\S]*?)\1/i);
  if (curlHeader) return curlHeader[2].trim();
  return text.replace(/^cookie:\s*/i, "").trim();
}

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
  options: { allowAddFile?: boolean } = {},
) {
  const byName = new Map(uploaded.map((f) => [f.name, f]));
  const next: Array<Record<string, unknown>> = [];
  const matchedNames = new Set<string>();
  for (const file of templateFiles || []) {
    if (byName.has(file.name)) { next.push(byName.get(file.name)!); matchedNames.add(file.name); }
    else { next.push(file); }
  }
  const missing = uploaded.filter((f: Record<string, unknown>) => !matchedNames.has(f.name as string));
  if (missing.length && !options.allowAddFile) {
    throw new Error(`Template trainFiles does not contain required file: ${missing.map((f) => f.name).join(", ")}`);
  }
  if (options.allowAddFile) { for (const f of missing) next.push(f); }
  return next;
}

function buildTaskPayload(
  templateData: Record<string, unknown>,
  job: { name: string; description: string },
  uploadedTrainFiles: Array<Record<string, unknown>>,
  options: { allowAddFile?: boolean } = {},
) {
  return {
    ...templateData,
    name: job.name,
    description: job.description,
    trainFiles: replaceTrainFiles((templateData.trainFiles as Array<Record<string, string>>) || [], uploadedTrainFiles, options),
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
    .option("--cookie-file <file>", "Cookie file path")
    .option("--template-job-internal-id <id>", "Numeric template job ID")
    .option("--template-job-url <url>", "Template job URL")
    .option("--name <name>", "Override job name from manifest")
    .option("--description <text>", "Override job description")
    .option("--execute", "Actually upload and create job (default: dry-run)", false)
    .option("--run", "Start job after creation", false)
    .option("--yes", "Required with --execute", false)
    .option("--allow-add-file", "Allow uploaded files absent from template trainFiles", false)
    .option("--out <dir>", "Output directory")
    .action(async (opts) => {
      const bundleDir = path.resolve(opts.bundle);
      const defaultOut = path.join("submit-live", new Date().toISOString().replace(/[:.]/g, "-"));
      const outDir = resolveTaijiOutputDir(opts.out ?? defaultOut);
      const { manifest, codeZip, config, runSh, genericFiles } = await loadBundle(bundleDir);
      const templateJobUrl = (opts.templateJobUrl || manifest.templateJobUrl) as string;
      const templateJobInternalId = opts.templateJobInternalId || inferInternalId(templateJobUrl);
      if (!templateJobInternalId) throw new Error("Missing --template-job-internal-id, and it could not be inferred");
      const jobName = (opts.name || ((manifest.job as Record<string, string> | undefined)?.name)) as string;
      if (!jobName) throw new Error("Missing --name and bundle manifest has no job.name");
      const jobDescription = (opts.description ?? ((manifest.job as Record<string, string> | undefined)?.description ?? "")) as string;
      const job = { name: jobName, description: jobDescription };

      const [zipMeta, configMeta, runShMeta, genericFileMetas] = await Promise.all([
        codeZip ? fileMeta(codeZip) : null,
        config ? fileMeta(config) : null,
        runSh ? fileMeta(runSh) : null,
        Promise.all(genericFiles.map(async (f) => ({ ...f, ...(await fileMeta(f.path)) }))),
      ]);

      const plan = {
        mode: opts.execute ? "execute" : "dry-run",
        templateJobUrl, templateJobInternalId,
        runAfterSubmit: Boolean(opts.run || manifest.runAfterSubmit),
        allowAddFile: Boolean(opts.allowAddFile),
        job,
        files: {
          ...(codeZip ? { codeZip: { path: codeZip, ...zipMeta } } : {}),
          ...(config ? { config: { path: config, ...configMeta } } : {}),
          ...(runSh ? { runSh: { path: runSh, ...runShMeta } } : {}),
          ...(genericFileMetas.length ? { genericFiles: genericFileMetas } : {}),
        },
      };

      if (opts.execute && !opts.yes) throw new Error("--execute requires --yes");
      if (!opts.cookieFile) {
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
        console.log(`Wrote dry-run plan without network: ${path.join(outDir, "plan.json")}`);
        return;
      }

      const client = await createDirectClient(opts.cookieFile);
      const cookieHeader = extractCookieHeader(await readFile(opts.cookieFile, "utf8"));
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
      const taskPayload = buildTaskPayload(templateData, job, uploadedTrainFiles, { allowAddFile: opts.allowAddFile });
      const networkPlan = { ...plan, cosPrefix, uploadedTrainFiles, taskPayloadPreview: safeResult(taskPayload) };

      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "plan.json"), `${JSON.stringify(networkPlan, null, 2)}\n`, "utf8");

      if (!opts.execute) {
        console.log(`Wrote dry-run plan: ${path.join(outDir, "plan.json")}`);
        console.log("No upload/create/start happened. Add --execute --yes to run live.");
        return;
      }

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
      if (opts.run || manifest.runAfterSubmit) {
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
