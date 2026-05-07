import { Command } from "commander";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { resolveTaijiOutputFile } from "../../../utils/output.js";
import type { ConfigChange, ConfigDiffResult } from "../../../types.js";

function formatPath(parts: (string | number)[]): string {
  if (!parts.length) return "$";
  return parts.map((p) => (typeof p === "number" ? `[${p}]` : String(p).replace(/[.[\]\\]/g, "\\$&")))
    .reduce((acc, part) => (part.startsWith("[") ? `${acc}${part}` : acc ? `${acc}.${part}` : part), "");
}

function isObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareValues(before: unknown, after: unknown, parts: (string | number)[] = []): ConfigChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const changes: ConfigChange[] = [];
  if (Array.isArray(before) && Array.isArray(after)) {
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (i >= before.length) changes.push({ type: "added", path: formatPath([...parts, i]), before: undefined, after: after[i] });
      else if (i >= after.length) changes.push({ type: "removed", path: formatPath([...parts, i]), before: before[i], after: undefined });
      else changes.push(...compareValues(before[i], after[i], [...parts, i]));
    }
  } else if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before as Record<string, unknown>), ...Object.keys(after as Record<string, unknown>)])].sort();
    for (const key of keys) {
      if (!(key in (before as Record<string, unknown>))) changes.push({ type: "added", path: formatPath([...parts, key]), before: undefined as unknown, after: (after as Record<string, unknown>)[key] });
      else if (!(key in (after as Record<string, unknown>))) changes.push({ type: "removed", path: formatPath([...parts, key]), before: (before as Record<string, unknown>)[key], after: undefined as unknown });
      else changes.push(...compareValues((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], [...parts, key]));
    }
  } else {
    changes.push({ type: "changed", path: formatPath(parts), before, after });
  }
  return changes;
}

export function registerTrainConfigDiffCommand(trainCmd: Command) {
  trainCmd
    .command("config-diff")
    .description("Semantic diff of two YAML configs")
    .argument("<oldFile>", "Old config YAML")
    .argument("<newFile>", "New config YAML")
    .option("--json", "Output as JSON")
    .option("--out <file>", "Output file path")
    .action(async (oldFile, newFile, opts) => {
      const [before, after] = await Promise.all([
        yaml.load(await readFile(oldFile, "utf8")),
        yaml.load(await readFile(newFile, "utf8")),
      ]);
      const changes = compareValues(before, after);
      const result: ConfigDiffResult = {
        oldFile: path.resolve(oldFile),
        newFile: path.resolve(newFile),
        summary: { total: changes.length, added: changes.filter((c) => c.type === "added").length, removed: changes.filter((c) => c.type === "removed").length, changed: changes.filter((c) => c.type === "changed").length },
        changes,
      };
      const output = opts.json ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2);
      if (opts.out) {
        const outPath = resolveTaijiOutputFile(opts.out);
        await mkdir(path.dirname(outPath), { recursive: true });
        await writeFile(outPath, output + "\n", "utf8");
        console.error(`Wrote config diff: ${outPath}`);
      } else {
        process.stdout.write(output);
      }
    });
}
