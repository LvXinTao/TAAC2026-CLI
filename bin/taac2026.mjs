#!/usr/bin/env node
// Compatibility shim: forwards to the TypeScript-compiled CLI entry point.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const child = spawn(process.execPath, [path.join(rootDir, "dist/cli/index.js"), ...process.argv.slice(2)], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) { process.kill(process.pid, signal); return; }
  process.exitCode = code ?? 1;
});
