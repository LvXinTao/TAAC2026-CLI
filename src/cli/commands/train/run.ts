import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { ensureCliAuth } from "../../../cli/middleware.js";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

const TAIJI_ORIGIN = "https://taiji.algo.qq.com";

function taijiHeaders(cookieHeader: string) {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    cookie: cookieHeader,
    referer: `${TAIJI_ORIGIN}/training`,
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

function resolveTaskId(input: string, outDir: string): string {
  // If it looks like a taskID (starts with angel_training_), use directly
  if (input.startsWith("angel_training_")) return input;

  // If numeric, look up in jobs.json or submit result
  const numeric = /^\d+$/.test(input);

  // Try jobs.json first
  if (numeric) {
    const taijiOutputDir = findTaijiOutputDir(outDir);
    if (taijiOutputDir) {
      try {
        const jobsData = JSON.parse(readFileSync(path.join(taijiOutputDir, "jobs.json"), "utf8"));
        for (const [, entry] of Object.entries(jobsData.jobsById ?? {}) as Array<[string, any]>) {
          if (String(entry.jobInternalId) === input) return entry.jobId;
        }
      } catch { /* not available */ }
    }
  }

  // Try submit result.json
  const resultPath = path.join(outDir, "result.json");
  if (existsSync(resultPath)) {
    try {
      const result = JSON.parse(readFileSync(resultPath, "utf8"));
      if (result.taskId) return result.taskId;
    } catch { /* not available */ }
  }

  throw new Error(`Cannot resolve task ID from "${input}". Provide a full taskID or check jobs.json.`);
}

export function registerTrainRunCommand(trainCmd: Command) {
  trainCmd
    .command("run")
    .description("Start a training job. --task-id accepts the full taskID string (angel_training_...) or a numeric internal ID (resolved via jobs.json).")
    .requiredOption("--task-id <id>", "Task ID — full taskID string (angel_training_...) or numeric internal ID")
    .option("--output <dir>", "Output directory for result (default: taiji-output/train-jobs)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output/train-jobs");
      const taskId = resolveTaskId(opts.taskId, outDir);

      const cookieHeader = await ensureCliAuth();

      const startResponse = await fetchJson(cookieHeader, `/taskmanagement/api/v1/webtasks/${taskId}/start`, { method: "POST", body: {} });
      const data = (startResponse as Record<string, unknown>).data as Record<string, unknown> | undefined;

      const result = {
        taskId,
        startedAt: new Date().toISOString(),
        response: data,
      };

      await writeFile(path.join(outDir, `run-${taskId}.json`), JSON.stringify(result, null, 2), "utf8");
      console.log(`Started job: ${taskId}`);
    });
}
