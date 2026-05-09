import { Command } from "commander";
import { createReadStream, existsSync } from "node:fs";
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
    referer: `${TAIJI_ORIGIN}/evaluation/create`,
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

function formatTaijiTime(date = new Date()): string {
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const bj = new Date(utc + 8 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${bj.getFullYear()}-${pad(bj.getMonth() + 1)}-${pad(bj.getDate())} ${pad(bj.getHours())}:${pad(bj.getMinutes())}:${pad(bj.getSeconds())}`;
}

function inferAccountPrefix(creator: string): string {
  // creator is like "ams_2026_1029731852466346144"
  return creator || "";
}

function newCosKey(prefix: string, filename: string): string {
  return `${prefix}/infer/local--${randomUUID().replaceAll("-", "")}/${filename}`;
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

function safeResult(result: unknown): unknown {
  return JSON.parse(JSON.stringify(result, (key, value) => {
    if (/cookie|token|secret|credential|authorization|signature/i.test(key)) return "<redacted>";
    return value;
  }));
}

export function registerEvalSubmitCommand(evalCmd: Command) {
  evalCmd
    .command("submit")
    .description("Upload bundle to COS and create a new evaluation task")
    .requiredOption("--bundle <dir>", "Prepared bundle directory")
    .requiredOption("--mould-id <id>", "Mould/Model ID for evaluation")
    .option("--yes", "Skip confirmation prompt", false)
    .option("--dry-run", "Preview without uploading", false)
    .option("--output <dir>", "Output directory for plan/result")
    .action(async (opts) => {
      const bundleDir = path.resolve(opts.bundle);
      const defaultOut = path.join("taiji-output", "eval-submit-live", new Date().toISOString().replace(/[:.]/g, "-"));
      const outDir = resolveTaijiOutputDir(opts.output ?? defaultOut);
      const { manifest, files: bundleFiles } = await loadBundle(bundleDir);

      // Job name/description from manifest
      const jobRecord = (manifest.job as Record<string, string> | undefined) ?? {};
      if (!jobRecord.name) throw new Error("Missing job.name in bundle manifest. Run `prepare` again with a valid `--name`.");
      const job = { name: jobRecord.name, description: jobRecord.description ?? "" };

      // Auth
      const cookieHeader = await ensureCliAuth();

      // Fetch template defaults (creator, image_name)
      const template = await fetchJson(cookieHeader, "/aide/api/evaluation_tasks/get_template/");
      // Response may be { data: {...} } or direct object
      const templateData = (template.data as Record<string, unknown> | undefined) ?? template;
      const creator = (templateData.creator as string | undefined) ?? "";
      const imageName = (templateData.image_name as string | undefined) ?? "";

      // Build COS prefix: {YEAR}_AMS_ALGO_Competition/{account_prefix}
      const accountPrefix = inferAccountPrefix(creator);
      const basePrefix = `${new Date().getFullYear()}_AMS_ALGO_Competition`;
      const cosPrefix = accountPrefix ? `${basePrefix}/${accountPrefix}` : basePrefix;
      const uploadFiles = bundleFiles.map((f) => ({
        name: f.name,
        cosKey: newCosKey(cosPrefix, f.name),
        localPath: f.localPath,
        size: 0, // filled by stat below
      }));

      // Get file sizes
      for (const f of uploadFiles) {
        const s = await stat(f.localPath);
        f.size = s.size;
      }

      const mode = opts.dryRun ? "dry-run" : "execute";

      // Safety check
      if (!opts.dryRun && !opts.yes) {
        throw new Error("--dry-run is not set; add --yes to confirm live execution");
      }

      const createPayload = {
        mould_id: parseInt(opts.mouldId, 10),
        name: job.name,
        image_name: imageName,
        creator,
        files: uploadFiles.map((f) => ({
          name: f.name,
          path: f.cosKey,
          mtime: formatTaijiTime(),
          size: f.size,
        })),
      };

      const plan = {
        mode,
        job,
        mouldId: opts.mouldId,
        uploadFiles: uploadFiles.map((f) => ({ name: f.name, cosKey: f.cosKey, size: f.size })),
        createPayload: safeResult(createPayload) as Record<string, unknown>,
      };

      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");

      if (opts.dryRun) {
        console.log(`Wrote dry-run plan: ${path.join(outDir, "plan.json")}`);
        console.log("No upload/create happened. Remove --dry-run and add --yes to run live.");
        return;
      }

      // Execute: upload files to COS, then create evaluation task
      const uploadResults: Array<{ key: string; bytes: number }> = [];
      for (const f of uploadFiles) {
        const result = await uploadToCos(cookieHeader, f.localPath, f.cosKey);
        uploadResults.push(result);
        console.log(`  Uploaded ${f.name} -> ${result.key}`);
      }

      const created = await fetchJson(cookieHeader, "/aide/api/evaluation_tasks/", {
        method: "POST",
        body: createPayload,
      });
      const data = (created as Record<string, unknown>).data as Record<string, unknown> | undefined;
      const taskId = data?.id;
      if (!taskId) throw new Error("Created evaluation task response has no data.id");

      const result = { ...plan, uploadResults, created: safeResult(created), taskId };
      await writeFile(path.join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
      console.log(`Created Taiji eval task: ${taskId}`);
      console.log(`Wrote live result: ${path.join(outDir, "result.json")}`);
    });
}
