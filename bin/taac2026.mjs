#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

const commands = {
  scrape: {
    script: "scripts/scrape-taiji.mjs",
    description: "Scrape Taiji jobs, metrics, logs, checkpoints, and code files.",
  },
  "diff-config": {
    script: "scripts/compare-config-yaml.mjs",
    description: "Compare two YAML config files semantically.",
  },
  "prepare-submit": {
    script: "scripts/prepare-taiji-submit.mjs",
    description: "Prepare a local Taiji submit bundle.",
  },
  submit: {
    script: "scripts/submit-taiji.mjs",
    description: "Dry-run or explicitly execute Taiji upload/create/run.",
  },
};

function usage() {
  return `TAAC2026 CLI

Usage:
  taac2026 <command> [options]

Commands:
${Object.entries(commands).map(([name, command]) => `  ${name.padEnd(15)} ${command.description}`).join("\n")}

Examples:
  taac2026 scrape --all --incremental --direct --cookie-file taiji-output/secrets/taiji-cookie.txt
  taac2026 diff-config old.yaml new.yaml --json --out diff.json
  taac2026 prepare-submit --template-job-url <url> --file-dir ./taiji-files --name exp_001
  taac2026 submit --bundle taiji-output/submit-bundle --template-job-internal-id <id>

Run 'taac2026 <command> --help' for command-specific options.`;
}

function run() {
  const [commandName, ...args] = process.argv.slice(2);
  if (!commandName || commandName === "--help" || commandName === "-h") {
    console.log(usage());
    return;
  }

  const command = commands[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}\n`);
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [path.join(rootDir, command.script), ...args], {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

run();
