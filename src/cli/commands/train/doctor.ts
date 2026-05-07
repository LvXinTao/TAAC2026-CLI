import { Command } from "commander";
import { readFile } from "node:fs/promises";
import path from "node:path";

export function registerTrainDoctorCommand(trainCmd: Command) {
  trainCmd
    .command("doctor")
    .description("Check submit bundle for issues")
    .requiredOption("--bundle <dir>", "Submit bundle directory")
    .option("--json", "Output as JSON")
    .option("--out <file>", "Output file path")
    .action(async (opts) => {
      const bundleDir = path.resolve(opts.bundle);
      const manifestPath = path.join(bundleDir, "manifest.json");
      const filesDir = path.join(bundleDir, "files");
      const issues: string[] = [];
      try { await readFile(manifestPath, "utf8"); } catch { issues.push("manifest.json not found"); }
      for (const name of ["code.zip", "config.yaml"]) {
        try { await readFile(path.join(filesDir, name)); } catch { issues.push(`${name} not found in bundle`); }
      }
      const result = { bundle: bundleDir, issues, ok: issues.length === 0 };
      console.log(JSON.stringify(result, null, 2));
    });
}
