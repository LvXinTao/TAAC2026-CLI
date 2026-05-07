#!/usr/bin/env node

import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { registerLoginCommand } from "./commands/login.js";
import { registerTrainCommand } from "./commands/train/index.js";
import { registerEvalCommand } from "./commands/eval/index.js";

const program = new Command();

program
  .name("taac2026")
  .description("Agent-friendly TAAC2026 / Taiji experiment CLI")
  .version(pkg.version);

registerLoginCommand(program);
registerTrainCommand(program);
registerEvalCommand(program);

program.parse();
