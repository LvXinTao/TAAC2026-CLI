import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

async function resolveInstanceId(cookieHeader: string, taskId: string): Promise<string> {
  const instances = await fetchJson(cookieHeader, "/taskmanagement/api/v1/instances/list", {
    method: "POST", body: { desc: true, orderBy: "create", task_id: taskId, page: 0, size: 10 },
  });
  const list = instances.data as Array<{ id: string }> | undefined;
  if (list && list.length > 0 && list[0].id) return list[0].id;
  throw new Error(`No instances found for task ${taskId}`);
}

export function registerTrainStopCommand(trainCmd: Command) {
  trainCmd
    .command("stop")
    .description("Stop a training job by killing its running instance. --task-id accepts the full taskID string (angel_training_...). The instance ID is resolved automatically from the API.")
    .requiredOption("--task-id <id>", "Task ID — full taskID string (angel_training_...)")
    .option("--output <dir>", "Output directory for result (default: taiji-output/train-jobs)")
    .action(async (opts) => {
      const outDir = resolveTaijiOutputDir(opts.output ?? "taiji-output/train-jobs");
      const taskId = opts.taskId;

      const cookieHeader = await ensureCliAuth();

      // Get instance ID for the task
      const instanceId = await resolveInstanceId(cookieHeader, taskId);

      const response = await fetchJson(cookieHeader, `/taskmanagement/api/v1/instances/${instanceId}/kill`, { method: "POST", body: {} });

      const result = {
        taskId,
        instanceId,
        stoppedAt: new Date().toISOString(),
        response,
      };

      await mkdir(outDir, { recursive: true });
      await writeFile(path.join(outDir, `stop-${taskId}.json`), JSON.stringify(result, null, 2), "utf8");
      console.log(`Stopped job ${taskId} (instance ${instanceId})`);
    });
}
