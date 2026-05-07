import { Command } from "commander";
import { access, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

const execFileAsync = promisify(execFile);
const PRIMARY_TRAIN_FILE_NAMES = new Set(["code.zip", "config.yaml", "run.sh"]);

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

function parseGenericFileSpec(spec: string): { sourcePath: string; name: string } {
  const separatorIndex = spec.lastIndexOf("=");
  const rawPath = separatorIndex > 0 ? spec.slice(0, separatorIndex) : spec;
  const name = separatorIndex > 0 ? spec.slice(separatorIndex + 1) : path.basename(path.normalize(rawPath));
  if (PRIMARY_TRAIN_FILE_NAMES.has(name)) {
    throw new Error(`reserved primary trainFile name: ${name}. Use --zip, --config, or --run-sh instead.`);
  }
  return { sourcePath: path.resolve(rawPath), name };
}

async function collectFileDirSpecs(fileDirs: string[]) {
  const result: { codeZip: string | null; config: string | null; runSh: string | null; genericSpecs: string[] } = {
    codeZip: null, config: null, runSh: null, genericSpecs: [],
  };
  for (const rawDir of fileDirs) {
    const dir = path.resolve(rawDir);
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fp = path.join(dir, entry.name);
      if (entry.name === "code.zip") { if (result.codeZip) throw new Error(`Duplicate code.zip in --file-dir: ${fp}`); result.codeZip = fp; }
      else if (entry.name === "config.yaml") { if (result.config) throw new Error(`Duplicate config.yaml in --file-dir: ${fp}`); result.config = fp; }
      else if (entry.name === "run.sh") { if (result.runSh) throw new Error(`Duplicate run.sh in --file-dir: ${fp}`); result.runSh = fp; }
      else { result.genericSpecs.push(fp); }
    }
  }
  return result;
}

async function fileInfo(fp: string) {
  const s = await stat(fp);
  return { path: fp, basename: path.basename(fp), bytes: s.size, mtime: s.mtime.toISOString() };
}

function makeNextSteps(manifest: Record<string, unknown>) {
  const files = manifest.files as Record<string, unknown>;
  const genericFiles = (files.genericFiles as Array<{ name: string; preparedPath: string }>) ?? [];
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
      : "3. No primary files were prepared; use the generic trainFiles in `files/generic/`.",
    files.runSh
      ? "4. Confirm the new `run.sh` entrypoint matches this experiment."
      : "4. Keep `run.sh` unchanged unless the experiment explicitly needs a new entrypoint.",
    ...(genericFiles.length ? [`4a. Replace generic trainFiles: ${genericFiles.map((f) => `\`${f.name}\``).join(", ")}.`] : []),
    "5. Fill Job Name and Job Description from `manifest.json`.",
    "6. Submit the copied Job.",
    "7. If `runAfterSubmit` is true, start the new Job and record the Job ID / instance ID.", "",
    "## Prepared values", "",
    `- Template Job URL: ${manifest.templateJobUrl}`,
    `- Job Name: ${(manifest.job as Record<string, string>).name}`,
    `- Job Description: ${(manifest.job as Record<string, string>).description || ""}`,
    `- Run after submit: ${manifest.runAfterSubmit}`,
    ...(files.codeZip ? [`- Code zip: files/${(files.codeZip as Record<string, string>).basename}`] : []),
    ...(files.config ? [`- Config: files/${(files.config as Record<string, string>).basename}`] : []),
    ...(files.runSh ? [`- run.sh: files/${(files.runSh as Record<string, string>).basename}`] : []),
    ...genericFiles.map((f) => `- ${f.name}: ${f.preparedPath}`), "",
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
    .requiredOption("--template-job-url <url>", "Template job URL")
    .requiredOption("--name <name>", "Job name")
    .option("--zip <path>", "Code zip path")
    .option("--config <path>", "Config YAML path")
    .option("--run-sh <path>", "run.sh path")
    .option("--file <path[=name]>", "Generic trainFile, repeatable", (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option("--file-dir <dir>", "Directory of trainFiles, repeatable", (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option("--description <text>", "Job description")
    .option("--message <text>", "Local note (e.g. git commit message)")
    .option("--run", "Mark run-after-submit", false)
    .option("--out <dir>", "Output directory (default: submit-bundle)")
    .option("--allow-dirty", "Skip git dirty warning", false)
    .action(async (opts) => {
      const fileDirSpecs = await collectFileDirSpecs(opts.fileDir);
      const codeZip = opts.zip ? path.resolve(opts.zip) : fileDirSpecs.codeZip;
      const config = opts.config ? path.resolve(opts.config) : fileDirSpecs.config;
      const runSh = opts.runSh ? path.resolve(opts.runSh) : fileDirSpecs.runSh;
      const genericFiles = [...fileDirSpecs.genericSpecs, ...opts.file].map(parseGenericFileSpec);
      const outDir = resolveTaijiOutputDir(opts.out ?? "submit-bundle");
      const filesDir = path.join(outDir, "files");
      const genericFilesDir = path.join(filesDir, "generic");

      if (codeZip && !(await exists(codeZip))) throw new Error(`Code zip not found: ${codeZip}`);
      if (config && !(await exists(config))) throw new Error(`Config file not found: ${config}`);
      if (codeZip && !path.basename(codeZip).toLowerCase().endsWith(".zip")) throw new Error(`--zip must be a .zip file: ${codeZip}`);
      if (runSh && !(await exists(runSh))) throw new Error(`run.sh not found: ${runSh}`);
      if (runSh && path.basename(runSh) !== "run.sh") throw new Error(`--run-sh must point to a file named run.sh: ${runSh}`);
      for (const f of genericFiles) { if (!(await exists(f.sourcePath))) throw new Error(`Generic trainFile not found: ${f.sourcePath}`); }
      if (!codeZip && !config && !runSh && !genericFiles.length) throw new Error("No trainFiles prepared. Provide --zip/--config/--run-sh, --file, or --file-dir.");

      const git = await getGitInfo();
      if (git.available && git.dirty && !opts.allowDirty) {
        console.warn("Warning: git working tree is dirty. Use --allow-dirty to mark this as intentional.");
      }

      await mkdir(filesDir, { recursive: true });
      if (genericFiles.length) await mkdir(genericFilesDir, { recursive: true });

      const copiedZip = codeZip ? path.join(filesDir, path.basename(codeZip)) : null;
      const copiedConfig = config ? path.join(filesDir, path.basename(config)) : null;
      const copiedRunSh = runSh ? path.join(filesDir, "run.sh") : null;
      if (codeZip) await copyFile(codeZip, copiedZip!);
      if (config) await copyFile(config, copiedConfig!);
      if (runSh) await copyFile(runSh, copiedRunSh!);

      const copiedGenericFiles = await Promise.all(genericFiles.map(async (f) => {
        const cp = path.join(genericFilesDir, f.name);
        await copyFile(f.sourcePath, cp);
        return { ...f, copiedPath: cp };
      }));

      const manifest = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        templateJobUrl: opts.templateJobUrl,
        runAfterSubmit: opts.run,
        job: { name: opts.name, description: opts.description || "", message: opts.message || "" },
        files: {
          ...(codeZip ? { codeZip: { ...(await fileInfo(codeZip)), preparedPath: path.relative(outDir, copiedZip!).replaceAll(path.sep, "/") } } : {}),
          ...(config ? { config: { ...(await fileInfo(config)), preparedPath: path.relative(outDir, copiedConfig!).replaceAll(path.sep, "/") } } : {}),
          ...(runSh ? { runSh: { ...(await fileInfo(runSh)), preparedPath: path.relative(outDir, copiedRunSh!).replaceAll(path.sep, "/") } } : {}),
          ...(copiedGenericFiles.length ? { genericFiles: await Promise.all(copiedGenericFiles.map(async (f) => ({ name: f.name, ...(await fileInfo(f.sourcePath)), preparedPath: path.relative(outDir, f.copiedPath).replaceAll(path.sep, "/") }))) } : {}),
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
