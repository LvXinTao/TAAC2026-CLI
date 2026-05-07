import { Command } from "commander";
import { registerTrainListCommand } from "./list.js";
import { registerTrainLogsCommand } from "./logs.js";
import { registerTrainMetricsCommand } from "./metrics.js";
import { registerTrainStopCommand } from "./stop.js";
import { registerTrainDeleteCommand } from "./delete.js";
import { registerTrainPrepareCommand } from "./prepare.js";
import { registerTrainSubmitCommand } from "./submit.js";
import { registerTrainCreateCommand } from "./create.js";
import { registerTrainRunCommand } from "./run.js";
import { registerTrainDoctorCommand } from "./doctor.js";
import { registerTrainVerifyCommand } from "./verify.js";
import { registerTrainCompareCommand } from "./compare.js";
import { registerTrainCompareRunsCommand } from "./compare-runs.js";
import { registerTrainCkptSelectCommand } from "./ckpt-select.js";
import { registerTrainConfigDiffCommand } from "./config-diff.js";
import { registerTrainLedgerCommand } from "./ledger.js";
import { registerTrainDiagnoseCommand } from "./diagnose.js";

export function registerTrainCommand(program: Command) {
  const trainCmd = program.command("train").description("Manage training tasks");
  registerTrainPrepareCommand(trainCmd);
  registerTrainSubmitCommand(trainCmd);
  registerTrainCreateCommand(trainCmd);
  registerTrainRunCommand(trainCmd);
  registerTrainListCommand(trainCmd);
  registerTrainLogsCommand(trainCmd);
  registerTrainMetricsCommand(trainCmd);
  registerTrainStopCommand(trainCmd);
  registerTrainDeleteCommand(trainCmd);
  registerTrainDoctorCommand(trainCmd);
  registerTrainVerifyCommand(trainCmd);
  registerTrainCompareCommand(trainCmd);
  registerTrainCompareRunsCommand(trainCmd);
  registerTrainCkptSelectCommand(trainCmd);
  registerTrainConfigDiffCommand(trainCmd);
  registerTrainLedgerCommand(trainCmd);
  registerTrainDiagnoseCommand(trainCmd);
}
