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
  assert.match(stdout, /describe/);
  assert.match(stdout, /logs/);
  assert.match(stdout, /metrics/);
  assert.match(stdout, /stop/);
  assert.match(stdout, /delete/);
});

test("taac2026 train prepare help includes expected options", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "prepare", "--help"], { cwd: toolDir });

  assert.match(stdout, /--template-id/);
  assert.match(stdout, /--name/);
  assert.match(stdout, /--zip/);
  assert.ok(!/--file-dir/.test(stdout), "--file-dir should not appear");
  assert.ok(!/--file </.test(stdout), "--file < should not appear");
});

test("taac2026 train submit help includes expected options", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "submit", "--help"], { cwd: toolDir });

  assert.match(stdout, /--bundle/);
  assert.match(stdout, /--dry-run/);
  assert.match(stdout, /--yes/);
  assert.ok(!/--execute/.test(stdout), "--execute should not appear");
  assert.ok(!/--cookie-file/.test(stdout), "--cookie-file should not appear");
});

test("taac2026 train describe help includes --job-id", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "describe", "--help"], { cwd: toolDir });

  assert.match(stdout, /--job-id/);
});

test("taac2026 train logs help includes --job-id", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "logs", "--help"], { cwd: toolDir });

  assert.match(stdout, /--job-id/);
  assert.ok(!/--cookie-file/.test(stdout), "--cookie-file should not appear");
});

test("taac2026 train metrics help includes --job-id", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "metrics", "--help"], { cwd: toolDir });

  assert.match(stdout, /--job-id/);
  assert.match(stdout, /--json/);
  assert.ok(!/--cookie-file/.test(stdout), "--cookie-file should not appear");
});

test("taac2026 train stop help includes --job-id", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "stop", "--help"], { cwd: toolDir });

  assert.match(stdout, /--job-id/);
  assert.ok(!/--cookie-file/.test(stdout), "--cookie-file should not appear");
});

test("taac2026 train delete help includes --job-id and --yes", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "train", "delete", "--help"], { cwd: toolDir });

  assert.match(stdout, /--job-id/);
  assert.match(stdout, /--yes/);
  assert.ok(!/--cookie-file/.test(stdout), "--cookie-file should not appear");
});

test("taac2026 login help has only --timeout", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "login", "--help"], { cwd: toolDir });

  assert.match(stdout, /--timeout/);
  assert.ok(!/--cookie-file/.test(stdout), "--cookie-file should not appear");
  assert.ok(!/--headless/.test(stdout), "--headless should not appear");
  assert.ok(!/--out/.test(stdout), "--out should not appear");
});

test("taac2026 eval prints subcommand list", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "eval", "--help"], { cwd: toolDir });

  assert.match(stdout, /list/);
  assert.match(stdout, /logs/);
  assert.match(stdout, /metrics/);
  assert.match(stdout, /create/);
});
