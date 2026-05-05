import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const toolDir = fileURLToPath(new URL("../..", import.meta.url));
const cliPath = fileURLToPath(new URL("../../bin/taac2026.mjs", import.meta.url));

test("taac2026 CLI prints top-level command help", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"], { cwd: toolDir });

  assert.match(stdout, /TAAC2026 CLI/);
  assert.match(stdout, /scrape/);
  assert.match(stdout, /diff-config/);
  assert.match(stdout, /prepare-submit/);
  assert.match(stdout, /submit/);
});

test("taac2026 CLI dispatches to bundled commands", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "prepare-submit", "--help"], { cwd: toolDir });

  assert.match(stdout, /prepare-taiji-submit/);
  assert.match(stdout, /--file-dir/);
});
