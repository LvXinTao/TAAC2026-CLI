import type { DirectClient } from "../types.js";
import { isDirectClient } from "../auth/token.js";

const TAIJI_ORIGIN = "https://taiji.algo.qq.com";
const TRAINING_URL = "https://taiji.algo.qq.com/training";

export interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  params?: Record<string, unknown>;
  body?: unknown;
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
        return await fetchDirect<T>(client, endpoint, { method, params: options.params, body: options.body });
      }
      if (isPlaywrightPage(client)) {
        return await fetchViaPage(client, endpoint, { method, params: options.params, body: options.body });
      }
      throw new Error("Unsupported client: expected DirectClient or Playwright page");
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
  options: { method?: string; params?: Record<string, unknown>; body?: unknown }
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = buildHeaders(client.directCookieHeader);

  // For POST requests, params go into the body, not URL query string
  let url: string;
  let requestBody: string | undefined;
  if (method === "POST") {
    url = buildUrl(endpoint);
    const data = options.body ?? options.params;
    if (data) {
      headers["content-type"] = "application/json";
      requestBody = JSON.stringify(data);
    }
  } else {
    url = buildUrl(endpoint, options.params);
    if (method !== "GET" && options.body) {
      headers["content-type"] = "application/json";
      requestBody = JSON.stringify(options.body);
    }
  }

  const requestInit: RequestInit = { method, headers };
  if (requestBody) requestInit.body = requestBody;

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

function isPlaywrightPage(client: unknown): boolean {
  const p = client as any;
  return p && typeof p.evaluate === "function" && typeof p.url === "function";
}

async function parseResponse<T>(response: any): Promise<T> {
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text);
  } catch {
    body = text as T;
  }
  if (!response.ok()) {
    throw new Error(`HTTP ${response.status()}: ${text.slice(0, 500)}`);
  }
  return body;
}

async function fetchViaPage<T = unknown>(
  page: any,
  endpoint: string,
  options: { method?: string; params?: Record<string, unknown>; body?: unknown }
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
  };

  // For POST requests, params go into the body, not URL query string
  let url: string;
  if (method === "POST") {
    url = buildUrl(endpoint);
    const data = options.body ?? options.params;
    if (data) {
      headers["content-type"] = "application/json";
      const requestOptions = { headers, data: typeof data === "string" ? data : JSON.stringify(data) };
      const response = await page.request.post(url, requestOptions);
      return parseResponse(response);
    }
  }
  url = buildUrl(endpoint, options.params);
  if (method !== "GET" && options.body) {
    headers["content-type"] = "application/json";
  }

  const requestOptions: any = { headers };
  if (method !== "GET" && options.body) {
    requestOptions.data = JSON.stringify(options.body);
  }

  let response: any;
  if (method === "GET") {
    response = await page.request.get(url, requestOptions);
  } else if (method === "POST") {
    response = await page.request.post(url, requestOptions);
  } else if (method === "PUT") {
    response = await page.request.put(url, requestOptions);
  } else if (method === "DELETE") {
    response = await page.request.delete(url, requestOptions);
  } else {
    throw new Error(`Unsupported HTTP method: ${method}`);
  }

  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text);
  } catch {
    body = text as T;
  }

  if (!response.ok()) {
    throw new Error(`HTTP ${response.status()}: ${text.slice(0, 500)}`);
  }

  return body;
}
