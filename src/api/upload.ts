import path from "node:path";
import { createRequire } from "node:module";
import type { CosToken, TrainFile, DownloadValidation } from "../types.js";
import { fetchJson } from "./client.js";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const BUCKET = "hunyuan-external-1258344706";
const REGION = "ap-guangzhou";

export const DOWNLOAD_VALIDATION_VERSION = 2;

export async function fetchFederationToken(client: unknown, authWaitMs?: number): Promise<CosToken> {
  const token = await fetchJson(client, "/aide/api/evaluation_tasks/get_federation_token/", { authWaitMs });
  for (const key of ["id", "key", "Token"]) {
    if (!(token as any)?.[key]) throw new Error(`Federation token missing ${key}`);
  }
  return token as CosToken;
}

export async function fetchCosResource(cos: InstanceType<typeof COS>, key: string): Promise<{ ok: boolean; buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    cos.getObject({ Bucket: BUCKET, Region: REGION, Key: key }, (error: Error, data: any) => {
      if (error) reject(error);
      else resolve({
        ok: true,
        contentType: data.headers?.["content-type"] ?? data.ContentType ?? "",
        buffer: Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body ?? ""),
      });
    });
  });
}

export function createCosClient(token: CosToken): InstanceType<typeof COS> {
  return new COS({
    SecretId: token.id,
    SecretKey: token.key,
    SecurityToken: token.Token,
  });
}

function isCosKey(rawPath: string): boolean {
  return /(^|\/)train\/local--[^/]+\/[^/]+$/i.test(rawPath);
}

function looksLikeHtml(buffer: Buffer, contentType: string): boolean {
  const head = buffer.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  return String(contentType).toLowerCase().includes("text/html") || head.startsWith("<!doctype html") || head.startsWith("<html");
}

function hasZipMagic(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) &&
    [0x04, 0x06, 0x08].includes(buffer[3])
  );
}

export function validateTrainFileDownload(file: TrainFile | undefined, download: { buffer: Buffer; contentType?: string }): DownloadValidation {
  const name = String(file?.name ?? path.basename(file?.path ?? file?.url ?? "file"));
  const buffer = download?.buffer;
  if (!Buffer.isBuffer(buffer)) throw new Error(`${name}: downloaded body is not a Buffer`);
  if (!buffer.length) throw new Error(`${name}: downloaded file is empty`);
  if (looksLikeHtml(buffer, download?.contentType ?? "")) throw new Error(`${name}: downloaded an HTML page instead of a trainFile`);

  const expectedSize = Number(file?.size);
  if (Number.isFinite(expectedSize) && expectedSize > 0 && buffer.length !== expectedSize) {
    throw new Error(`${name}: size mismatch, expected ${expectedSize} bytes, got ${buffer.length}`);
  }

  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".zip") && !hasZipMagic(buffer)) throw new Error(`${name}: ZIP magic mismatch`);

  return { bytes: buffer.length, contentType: download?.contentType ?? "" };
}

export const COS_CONSTS = { BUCKET, REGION };
