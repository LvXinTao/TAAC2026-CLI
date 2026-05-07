import type { DirectClient } from "../types";
import { isDirectClient } from "../auth/token";

const TAIJI_ORIGIN = "https://taiji.algo.qq.com";
const TRAINING_URL = "https://taiji.algo.qq.com/training";

export interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  authWaitMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface FetchResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  body: T;
  text?: string;
}

function buildUrl(endpoint: string, params?: Record<string, unknown>): string {
  const url = new URL(endpoint, TAIJI_ORIGIN);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.href;
}

function buildHeaders(cookieHeader?: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
    referer: TRAINING_URL,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
  };
}

export async function fetchJson<T = unknown>(
  client: unknown,
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 1000;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (isDirectClient(client)) {
        return await fetchDirect<T>(client, endpoint, { method, params: options.params });
      }
      throw new Error("Browser mode requires a Playwright page object");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error("Unknown error");
}

async function fetchDirect<T = unknown>(
  client: DirectClient,
  endpoint: string,
  options: { method?: string; params?: Record<string, unknown> }
): Promise<T> {
  const url = buildUrl(endpoint, options.params);
  const method = options.method ?? "GET";
  const headers = buildHeaders(client.directCookieHeader);
  const requestInit: RequestInit = { method, headers };

  if (method !== "GET" && options.params) {
    headers["content-type"] = "application/json";
    requestInit.body = JSON.stringify(options.params);
  }

  const response = await fetch(url, requestInit);
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text);
  } catch {
    body = text as T;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }

  return body;
}

export async function fetchBinary(
  client: unknown,
  resourceUrl: string
): Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string }> {
  if (isDirectClient(client)) {
    return fetchBinaryDirect(client, resourceUrl);
  }
  throw new Error("Browser mode not yet implemented");
}

async function fetchBinaryDirect(
  client: DirectClient,
  resourceUrl: string
): Promise<{ ok: boolean; status: number; buffer: Buffer; contentType: string }> {
  const response = await fetch(resourceUrl, {
    headers: {
      accept: "*/*",
      cookie: client.directCookieHeader,
      referer: TRAINING_URL,
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}
