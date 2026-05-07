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

  assert.match(stdout, /taac2026/);
  assert.match(stdout, /login/);
  assert.match(stdout, /train/);
  assert.match(stdout, /eval/);
});

test("taac2026 train prints subcommand list", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "--help"], { cwd: toolDir });

  assert.match(stdout, /prepare/);
  assert.match(stdout, /submit/);
  assert.match(stdout, /list/);
  assert.match(stdout, /logs/);
  assert.match(stdout, /metrics/);
  assert.match(stdout, /config-diff/);
  assert.match(stdout, /doctor/);
  assert.match(stdout, /compare/);
});

test("taac2026 train prepare help includes expected options", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "prepare", "--help"], { cwd: toolDir });

  assert.match(stdout, /--template-job-url/);
  assert.match(stdout, /--file-dir/);
  assert.match(stdout, /--name/);
});

test("taac2026 train submit help includes execute flag", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "submit", "--help"], { cwd: toolDir });

  assert.match(stdout, /--bundle/);
  assert.match(stdout, /--execute/);
});
