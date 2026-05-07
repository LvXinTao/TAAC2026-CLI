import { strict as assert } from "node:assert";
import { test } from "node:test";
import path from "node:path";
import { resolveTaijiOutputDir, resolveTaijiOutputFile, assertSafeRelativeOutputPath } from "../dist/utils/output.js";

test("resolveTaijiOutputDir resolves relative under taiji-output", () => {
  const result = resolveTaijiOutputDir("submit-bundle");
  assert.ok(result.endsWith("taiji-output/submit-bundle"));
});

test("resolveTaijiOutputDir passes through absolute", () => {
  const result = resolveTaijiOutputDir("/abs/path");
  assert.strictEqual(result, "/abs/path");
});

test("assertSafeRelativeOutputPath rejects ..", () => {
  assert.throws(() => assertSafeRelativeOutputPath("../escape"), /must not contain '\.\.'/);
});

test("resolveTaijiOutputFile resolves relative under config-diffs", () => {
  const result = resolveTaijiOutputFile("diff.json");
  assert.ok(result.endsWith("taiji-output/config-diffs/diff.json"));
});
