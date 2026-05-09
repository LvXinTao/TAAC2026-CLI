import type { EvaluationTask } from "../types.js";
import { fetchJson } from "./client.js";

export async function fetchEvaluationTasks(
  client: unknown,
  pageSize: number,
  authWaitMs?: number,
): Promise<EvaluationTask[]> {
  const tasks: EvaluationTask[] = [];
  for (let pageNum = 1; ; pageNum++) {
    const response = await fetchJson(client, "/aide/api/evaluation_tasks/", {
      params: { page: pageNum, page_size: pageSize },
      authWaitMs,
    });
    const rows = (response as Record<string, unknown>)?.results as unknown[] | undefined ?? [];
    tasks.push(...(rows as EvaluationTask[]));
    if (!rows.length || rows.length < pageSize || (response as Record<string, unknown>)?.next == null) break;
  }
  return tasks;
}

export async function fetchEvaluationLog(
  client: unknown,
  taskId: string,
  authWaitMs?: number,
): Promise<unknown> {
  return fetchJson(client, "/aide/api/evaluation_tasks/event_log/", {
    params: { task_id: taskId },
    authWaitMs,
  });
}

export async function createEvaluationTask(client: unknown, payload: Record<string, unknown>): Promise<unknown> {
  return fetchJson(client, "/aide/api/evaluation_tasks/", {
    method: "POST",
    body: payload,
  });
}

export async function fetchEvaluationTemplate(
  client: unknown,
  authWaitMs?: number,
): Promise<Record<string, unknown>> {
  return fetchJson(client, "/aide/api/evaluation_tasks/get_template/", {
    authWaitMs,
  });
}
