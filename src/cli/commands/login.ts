import { Command } from "commander";

export function registerLoginCommand(program: Command) {
  program
    .command("login")
    .description("Browser SSO login, save cookie")
    .option("--cookie-file <file>", "Output cookie file path")
    .option("--headless", "Launch Chromium in headless mode")
    .option("--timeout <ms>", "Login timeout in ms", (v) => parseInt(v, 10))
    .action(async (_opts) => {
      console.log("login command — to be implemented");
    });
}
