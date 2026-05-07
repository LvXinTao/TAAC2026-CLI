import path from "node:path";

const DEFAULT_OUT_ROOT = "taiji-output";
const DEFAULT_OUT_DIR = "taiji-output/config-diffs";

export function assertSafeRelativeOutputPath(outPath: string): void {
  if (!path.isAbsolute(outPath) && outPath.split(/[\\/]+/).includes("..")) {
    throw new Error(
      `Relative output paths must not contain '..'. Use an absolute path for custom locations outside ${DEFAULT_OUT_ROOT}.`
    );
  }
}

export function resolveTaijiOutputDir(outDir: string): string {
  assertSafeRelativeOutputPath(outDir);
  if (path.isAbsolute(outDir)) return outDir;
  if (outDir.split(/[\\/]/)[0] === DEFAULT_OUT_ROOT) return path.resolve(outDir);
  return path.resolve(DEFAULT_OUT_ROOT, outDir);
}

export function resolveTaijiOutputFile(outPath: string): string {
  assertSafeRelativeOutputPath(outPath);
  if (path.isAbsolute(outPath)) return outPath;
  if (outPath.split(/[\\/]/)[0] === "taiji-output") return path.resolve(outPath);
  if (path.dirname(outPath) === ".") return path.resolve(DEFAULT_OUT_DIR, outPath);
  return path.resolve("taiji-output", outPath);
}

export const DEFAULTS = {
  OUT_ROOT: DEFAULT_OUT_ROOT,
  OUT_DIR: DEFAULT_OUT_DIR,
} as const;
