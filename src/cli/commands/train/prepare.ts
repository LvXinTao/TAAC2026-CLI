import { Command } from "commander";
import { access, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveTaijiOutputDir } from "../../../utils/output.js";

const execFileAsync = promisify(execFile);

// File patterns to include when scanning a source directory
const TRAIN_FILE_PATTERNS = [
  /\.py$/,       // Python files
  /\.sh$/,       // Shell scripts
  /\.json$/,     // Config JSON (ns_groups.json, etc.)
  /\.yaml$/,     // YAML configs
  /\.yml$/,
  /\.toml$/,
  /\.txt$/,
  /\.cfg$/,
  /\.ini$/,
];

// Files that should always be treated as trainFiles (not generic)
const PRIMARY_FILES = new Set(["run.sh", "train.py", "model.py", "trainer.py", "dataset.py", "utils.py", "config.yaml"]);

async function exists(p: string) {
  try { await access(p); return true; } catch { return false; }
}

async function runGit(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { timeout: 10000 });
    return stdout.trim();
  } catch { return null; }
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
    available: true, root, branch, head,
    dirty: Boolean(statusShort), statusShort: statusShort || "",
  };
}

async function scanDir(srcDir: string): Promise<string[]> {
  const entries = await readdir(srcDir);
  const files: string[] = [];
  for (const entry of entries) {
    const fp = path.join(srcDir, entry);
    const s = await stat(fp);
    if (s.isDirectory()) {
      // Include subdirectories that look like inference/
      if (entry === "inference") {
        const subFiles = await scanDir(fp);
        files.push(...subFiles);
      }
    } else if (TRAIN_FILE_PATTERNS.some((pat) => pat.test(entry))) {
      files.push(fp);
    }
  }
  return files;
}

async function fileInfo(fp: string) {
  const s = await stat(fp);
  return { path: fp, basename: path.basename(fp), bytes: s.size, mtime: s.mtime.toISOString() };
}

function makeNextSteps(manifest: Record<string, unknown>) {
  const files = manifest.files as Array<Record<string, unknown>>;
  const lines = [
    "# Taiji Submit Next Steps", "",
    "This directory was prepared by `taac2026 train prepare`.", "",
    "## Intended live workflow", "",
    "1. Run `taac2026 train submit --bundle <dir> --yes` to upload and create the job.",
    "2. Run `taac2026 train run --task-id <id>` to start the job (optional).", "",
    "## Prepared values", "",
    `- Template Job ID: ${manifest.templateJobId}`,
    `- Job Name: ${(manifest.job as Record<string, string>).name}`,
    `- Job Description: ${(manifest.job as Record<string, string>).description || ""}`,
    `- Files: ${files.map((f) => f.name).join(", ")}`, "",
    "## Automation note", "",
    "The submit command uploads files to COS and creates a new training job via API.", "",
  ];
  return `${lines.join("\n")}\n`;
}

export function registerTrainPrepareCommand(trainCmd: Command) {
  trainCmd
    .command("prepare")
    .description("Prepare a submission bundle from a source directory")
    .requiredOption("--template-id <id>", "Template job ID — the full taskID string (e.g. angel_training_ams_...)")
    .requiredOption("--name <name>", "Job name")
    .requiredOption("--source <dir>", "Source directory containing model code")
    .option("--include <patterns>", "Comma-separated glob patterns to include (e.g. '*.py,*.sh')")
    .option("--exclude <patterns>", "Comma-separated patterns to exclude (e.g. '__pycache__',*.pyc)")
    .option("--description <text>", "Job description")
    .option("--output <dir>", "Output directory (default: submit-bundle)")
    .action(async (opts) => {
      const srcDir = path.resolve(opts.source);
      if (!(await exists(srcDir))) throw new Error(`Source directory not found: ${srcDir}`);

      const outDir = resolveTaijiOutputDir(opts.output ?? "submit-bundle");
      const filesDir = path.join(outDir, "files");

      // Parse include/exclude patterns
      const excludePatterns = opts.exclude
        ? opts.exclude.split(",").map((p: string) => p.trim())
        : ["__pycache__", "*.pyc", "*.egg-info", ".git", ".DS_Store", "inference/"];

      const scanFiles = await scanDir(srcDir);

      // Filter out excluded patterns
      const filteredFiles = scanFiles.filter((fp) => {
        const rel = path.relative(srcDir, fp);
        return !excludePatterns.some((pat: string) => rel.includes(pat) || rel.endsWith(pat));
      });

      if (filteredFiles.length === 0) {
        throw new Error("No source files found. Check the source directory or --exclude patterns.");
      }

      const git = await getGitInfo();
      await mkdir(filesDir, { recursive: true });

      // Copy files preserving relative paths
      const fileEntries: Array<Record<string, unknown>> = [];
      for (const srcFile of filteredFiles) {
        const relPath = path.relative(srcDir, srcFile);
        const destPath = path.join(filesDir, relPath);
        await mkdir(path.dirname(destPath), { recursive: true });
        await copyFile(srcFile, destPath);
        fileEntries.push({
          name: relPath,
          preparedPath: path.relative(outDir, destPath).replaceAll(path.sep, "/"),
          isPrimary: PRIMARY_FILES.has(relPath) ? "true" : "false",
          ...(await fileInfo(srcFile)),
        });
      }

      const manifest = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        sourceDir: opts.source,
        templateJobId: opts.templateId,
        job: { name: opts.name, description: opts.description || "" },
        files: fileEntries,
        git,
      };

      await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      await writeFile(path.join(outDir, "NEXT_STEPS.md"), makeNextSteps(manifest), "utf8");

      console.log(`Prepared Taiji submission bundle: ${outDir}`);
      console.log(`  ${fileEntries.length} files copied to files/`);
      console.log(`  Manifest: ${path.join(outDir, "manifest.json")}`);
      console.log(`  Next steps: ${path.join(outDir, "NEXT_STEPS.md")}`);
    });
}
