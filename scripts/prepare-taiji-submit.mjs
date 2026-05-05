#!/usr/bin/env node
import { access, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_OUT_ROOT = "taiji-output";

function usage() {
  return `Usage:
  node scripts/prepare-taiji-submit.mjs --template-job-url <url> --zip <code.zip> --config <config.yaml> --name <job-name> [options]

Options:
  --description <text>   Job Description to use on Taiji.
  --run                  Mark the prepared submission as run-after-submit.
  --out <dir>            Output directory. Relative paths are placed under taiji-output/. Default: taiji-output/submit-bundle
  --message <text>       Optional local note, often matching the git commit message.
  --allow-dirty          Do not warn when the local git working tree is dirty.
  --help                 Show this help.

This tool prepares a deterministic local submission bundle. It does not upload,
click, submit, or run a Taiji job by itself. Use it as the safe input layer for
browser/API automation after the platform upload flow is captured.`;
}

function parseArgs(argv) {
  const args = {
    run: false,
    out: "submit-bundle",
    allowDirty: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--run") {
      args.run = true;
    } else if (arg === "--allow-dirty") {
      args.allowDirty = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return args;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runGit(args) {
  try {
    const { stdout } = await execFileAsync("git", args, { timeout: 10000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getGitInfo() {
  const root = await runGit(["rev-parse", "--show-toplevel"]);
  if (!root) {
    return { available: false };
  }

  const [head, branch, statusShort] = await Promise.all([
    runGit(["rev-parse", "HEAD"]),
    runGit(["branch", "--show-current"]),
    runGit(["status", "--short"]),
  ]);

  return {
    available: true,
    root,
    branch,
    head,
    dirty: Boolean(statusShort),
    statusShort: statusShort || "",
  };
}

function requireArg(args, name) {
  if (!args[name]) {
    throw new Error(`Missing required option --${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  }
}

function safeBasename(filePath) {
  return path.basename(path.normalize(filePath));
}

function resolveTaijiOutputDir(outDir) {
  if (path.isAbsolute(outDir)) return outDir;
  if (outDir.split(/[\\/]/)[0] === DEFAULT_OUT_ROOT) return path.resolve(outDir);
  return path.resolve(DEFAULT_OUT_ROOT, outDir);
}

async function fileInfo(filePath) {
  const s = await stat(filePath);
  return {
    path: filePath,
    basename: safeBasename(filePath),
    bytes: s.size,
    mtime: s.mtime.toISOString(),
  };
}

function makeNextSteps(manifest) {
  const lines = [
    "# Taiji Submit Next Steps",
    "",
    "This directory was prepared by `prepare-taiji-submit.mjs`.",
    "",
    "## Intended live workflow",
    "",
    "1. Open the template Job URL in a logged-in browser.",
    "2. Copy the template Job.",
    "3. Replace the code zip and config file with the files in `files/`.",
    "4. Keep `run.sh` unchanged unless the experiment explicitly needs a new entrypoint.",
    "5. Fill Job Name and Job Description from `manifest.json`.",
    "6. Submit the copied Job.",
    "7. If `runAfterSubmit` is true, start the new Job and record the Job ID / instance ID.",
    "",
    "## Prepared values",
    "",
    `- Template Job URL: ${manifest.templateJobUrl}`,
    `- Job Name: ${manifest.job.name}`,
    `- Job Description: ${manifest.job.description || ""}`,
    `- Run after submit: ${manifest.runAfterSubmit}`,
    `- Code zip: files/${manifest.files.codeZip.basename}`,
    `- Config: files/${manifest.files.config.basename}`,
    "",
    "## Automation note",
    "",
    "Live API/browser submission is intentionally not executed by this preparation tool.",
    "Before enabling it, capture one successful manual Copy Job -> upload zip/config -> submit -> run flow from DevTools, including upload endpoints and request payloads.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  requireArg(args, "templateJobUrl");
  requireArg(args, "zip");
  requireArg(args, "config");
  requireArg(args, "name");

  const codeZip = path.resolve(args.zip);
  const config = path.resolve(args.config);
  const outDir = resolveTaijiOutputDir(args.out);
  const filesDir = path.join(outDir, "files");

  if (!(await exists(codeZip))) {
    throw new Error(`Code zip not found: ${codeZip}`);
  }
  if (!(await exists(config))) {
    throw new Error(`Config file not found: ${config}`);
  }
  if (!safeBasename(codeZip).toLowerCase().endsWith(".zip")) {
    throw new Error(`--zip must point to a .zip file: ${codeZip}`);
  }

  const git = await getGitInfo();
  if (git.available && git.dirty && !args.allowDirty) {
    console.warn("Warning: git working tree is dirty. Use --allow-dirty to mark this as intentional.");
  }

  await mkdir(filesDir, { recursive: true });

  const copiedZip = path.join(filesDir, safeBasename(codeZip));
  const copiedConfig = path.join(filesDir, safeBasename(config));
  await copyFile(codeZip, copiedZip);
  await copyFile(config, copiedConfig);

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    templateJobUrl: args.templateJobUrl,
    runAfterSubmit: args.run,
    job: {
      name: args.name,
      description: args.description || "",
      message: args.message || "",
    },
    files: {
      codeZip: {
        ...(await fileInfo(codeZip)),
        preparedPath: path.relative(outDir, copiedZip).replaceAll(path.sep, "/"),
      },
      config: {
        ...(await fileInfo(config)),
        preparedPath: path.relative(outDir, copiedConfig).replaceAll(path.sep, "/"),
      },
    },
    git,
  };

  const manifestPath = path.join(outDir, "manifest.json");
  const nextStepsPath = path.join(outDir, "NEXT_STEPS.md");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(nextStepsPath, makeNextSteps(manifest), "utf8");

  console.log(`Prepared Taiji submission bundle: ${outDir}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Next steps: ${nextStepsPath}`);
  if (git.available && git.dirty && !args.allowDirty) {
    console.log("Git warning: working tree is dirty; manifest still records the exact status.");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
