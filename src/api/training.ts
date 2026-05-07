import type { TrainingJob, JobInstance, JobDetail } from "../types.js";
import { fetchJson, type FetchOptions } from "./client.js";

function extractRows(response: unknown): unknown[] {
  const data = (response as any)?.data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray((response as any)?.list)) return (response as any).list;
  return [];
}

function extractTotal(response: unknown): number | null {
  return (
    (response as any)?.data?.totalCount ??
    (response as any)?.data?.total ??
    (response as any)?.data?.count ??
    (response as any)?.totalCount ??
    (response as any)?.total ??
    null
  );
}

export async function fetchTrainingJobs(
  client: unknown,
  pageSize: number,
  authWaitMs?: number
): Promise<TrainingJob[]> {
  const jobs: TrainingJob[] = [];
  for (let pageNum = 0; ; pageNum++) {
    const response = await fetchJson(client, "/taskmanagement/api/v1/webtasks/external/task", {
      params: { pageNum, pageSize },
      authWaitMs,
    });
    const rows = extractRows(response);
    jobs.push(...(rows as TrainingJob[]));
    const total = extractTotal(response);
    if (!rows.length || rows.length < pageSize || (total != null && jobs.length >= total)) break;
  }
  return jobs;
}

export async function fetchJobInstances(
  client: unknown,
  taskID: string,
  pageSize: number,
  authWaitMs?: number
): Promise<JobInstance[]> {
  const instances: JobInstance[] = [];
  for (let pageNum = 0; ; pageNum++) {
    const response = await fetchJson(client, "/taskmanagement/api/v1/instances/list", {
      method: "POST",
      params: { desc: true, orderBy: "create", task_id: taskID, page: pageNum, size: pageSize },
      authWaitMs,
    });
    const rows = extractRows(response);
    instances.push(...(rows as JobInstance[]));
    const total = extractTotal(response);
    if (!rows.length || rows.length < pageSize || (total != null && instances.length >= total)) break;
  }
  return instances;
}

export async function fetchJobDetail(client: unknown, jobInternalId: string, authWaitMs?: number): Promise<JobDetail> {
  return fetchJson(client, `/taskmanagement/api/v1/webtasks/external/task/${jobInternalId}`, { authWaitMs });
}

export async function fetchInstanceOutput(client: unknown, instanceId: string, authWaitMs?: number): Promise<Record<string, unknown>> {
  const [checkpoints, tfEvents] = await Promise.all([
    fetchJson(client, `/taskmanagement/api/v1/instances/external/${instanceId}/get_ckpt`, { authWaitMs }),
    fetchJson(client, `/taskmanagement/api/v1/instances/external/${instanceId}/tf_events`, { authWaitMs }),
  ]);
  return {
    checkpoints: (checkpoints as any)?.data ?? checkpoints,
    metrics: (tfEvents as any)?.data?.data ?? {},
    metricSummary: summarizeMetrics((tfEvents as any)?.data?.data ?? {}),
  };
}

export async function fetchInstanceLog(client: unknown, instanceId: string, authWaitMs?: number): Promise<unknown> {
  return fetchJson(client, `/taskmanagement/api/v1/instances/${instanceId}/pod_log`, { authWaitMs });
}

function summarizeMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
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
    })
  );
}

function normalizeMetricRows(metricName: string, payload: unknown): any[] {
  if (!payload) return [];
  const arr = Array.isArray(payload) ? payload : [payload];
  return arr.flatMap((p, i) => {
    const dates = Array.isArray((p as any)?.date) ? (p as any).date : [];
    const titles = Array.isArray((p as any)?.title) ? (p as any).title : [];
    const values = Array.isArray((p as any)?.value) ? (p as any).value : [];
    const rows: any[] = [];
    for (let si = 0; si < Math.max(titles.length, values.length); si++) {
      const seriesName = titles[si] ?? `${metricName}_${si}`;
      const seriesValues = Array.isArray(values[si]) ? values[si] : [];
      for (let pi = 0; pi < seriesValues.length; pi++) {
        rows.push({ metric: metricName, series: seriesName, step: dates[pi] ?? pi, value: seriesValues[pi] });
      }
    }
    return rows;
  });
}
