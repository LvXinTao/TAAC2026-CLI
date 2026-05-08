import { Command } from "commander";
import { access, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

const execFileAsync = promisify(execFile);

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function runGit(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { timeout: 10000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getGitInfo() {
  const root = await runGit(["rev-parse", "--show-toplevel"]);
  if (!root) return { available: false };
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

async function fileInfo(fp: string) {
  const s = await stat(fp);
  return { path: fp, basename: path.basename(fp), bytes: s.size, mtime: s.mtime.toISOString() };
}

function makeNextSteps(manifest: Record<string, unknown>) {
  const files = manifest.files as Record<string, unknown>;
  const primaryNames = [
    files.codeZip ? "code zip" : null,
    files.config ? "config file" : null,
    files.runSh ? "`run.sh`" : null,
  ].filter(Boolean);
  const lines = [
    "# Taiji Submit Next Steps", "",
    "This directory was prepared by `prepare-taiji-submit.mjs`.", "",
    "## Intended live workflow", "",
    "1. Open the template Job URL in a logged-in browser.",
    "2. Copy the template Job.",
    primaryNames.length
      ? `3. Replace ${primaryNames.join(", ")} with the files in \`files/\`.`
      : "3. No primary files were prepared.",
    files.runSh
      ? "4. Confirm the new `run.sh` entrypoint matches this experiment."
      : "4. Keep `run.sh` unchanged unless the experiment explicitly needs a new entrypoint.",
    "5. Fill Job Name and Job Description from `manifest.json`.",
    "6. Submit the copied Job.",
    "7. Record the Job ID / instance ID.", "",
    "## Prepared values", "",
    `- Template Job ID: ${manifest.templateJobId}`,
    `- Job Name: ${(manifest.job as Record<string, string>).name}`,
    `- Job Description: ${(manifest.job as Record<string, string>).description || ""}`,
    ...(files.codeZip ? [`- Code zip: files/${(files.codeZip as Record<string, string>).basename}`] : []),
    ...(files.config ? [`- Config: files/${(files.config as Record<string, string>).basename}`] : []),
    ...(files.runSh ? [`- run.sh: files/${(files.runSh as Record<string, string>).basename}`] : []), "",
    "## Automation note", "",
    "Live API/browser submission is intentionally not executed by this preparation tool.",
    "Before enabling it, capture one successful manual Copy Job -> upload zip/config -> submit -> run flow from DevTools.", "",
  ];
  return `${lines.join("\n")}\n`;
}

export function registerTrainPrepareCommand(trainCmd: Command) {
  trainCmd
    .command("prepare")
    .description("Prepare a submission bundle without uploading")
    .requiredOption("--template-id <id>", "Template job URL or internal ID")
    .requiredOption("--name <name>", "Job name")
    .option("--zip <path>", "Path to code.zip")
    .option("--config <path>", "Path to config.yaml")
    .option("--run-sh <path>", "Path to run.sh")
    .option("--description <text>", "Job description")
    .option("--output <dir>", "Output directory (default: submit-bundle)")
    .action(async (opts) => {
      const codeZip = opts.zip ? path.resolve(opts.zip) : null;
      const config = opts.config ? path.resolve(opts.config) : null;
      const runSh = opts.runSh ? path.resolve(opts.runSh) : null;
      const outDir = resolveTaijiOutputDir(opts.output ?? "submit-bundle");
      const filesDir = path.join(outDir, "files");

      if (codeZip && !(await exists(codeZip))) throw new Error(`Code zip not found: ${codeZip}`);
      if (config && !(await exists(config))) throw new Error(`Config file not found: ${config}`);
      if (codeZip && !path.basename(codeZip).toLowerCase().endsWith(".zip")) throw new Error(`--zip must be a .zip file: ${codeZip}`);
      if (runSh && !(await exists(runSh))) throw new Error(`run.sh not found: ${runSh}`);
      if (runSh && path.basename(runSh) !== "run.sh") throw new Error(`--run-sh must point to a file named run.sh: ${runSh}`);
      if (!codeZip && !config && !runSh) {
        throw new Error("No trainFiles prepared. Provide at least one of --zip, --config, or --run-sh.");
      }

      const git = await getGitInfo();

      await mkdir(filesDir, { recursive: true });

      const copiedZip = codeZip ? path.join(filesDir, path.basename(codeZip)) : null;
      const copiedConfig = config ? path.join(filesDir, path.basename(config)) : null;
      const copiedRunSh = runSh ? path.join(filesDir, "run.sh") : null;
      if (codeZip) await copyFile(codeZip, copiedZip!);
      if (config) await copyFile(config, copiedConfig!);
      if (runSh) await copyFile(runSh, copiedRunSh!);

      const manifest = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        templateJobId: opts.templateId,
        job: { name: opts.name, description: opts.description || "" },
        files: {
          ...(codeZip ? { codeZip: { ...(await fileInfo(codeZip)), preparedPath: path.relative(outDir, copiedZip!).replaceAll(path.sep, "/") } } : {}),
          ...(config ? { config: { ...(await fileInfo(config)), preparedPath: path.relative(outDir, copiedConfig!).replaceAll(path.sep, "/") } } : {}),
          ...(runSh ? { runSh: { ...(await fileInfo(runSh)), preparedPath: path.relative(outDir, copiedRunSh!).replaceAll(path.sep, "/") } } : {}),
        },
        git,
      };

      await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await writeFile(path.join(outDir, "NEXT_STEPS.md"), makeNextSteps(manifest), "utf8");
      console.log(`Prepared Taiji submission bundle: ${outDir}`);
      console.log(`Manifest: ${path.join(outDir, "manifest.json")}`);
      console.log(`Next steps: ${path.join(outDir, "NEXT_STEPS.md")}`);
    });
}
