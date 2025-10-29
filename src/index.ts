#!/usr/bin/env node

import { spawn } from "child_process";
import fs from "fs";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  AccountRecord,
  AccountsConfig,
  getAuthFilePath,
  getAuthStatus,
  loadConfig,
  saveConfig,
} from "./config.js";
import { SHARED_CODEX_HOME } from "./paths.js";
import { hydrateActiveAuth, persistActiveAuth } from "./codexHome.js";
import { clearScreen, renderDashboard, renderExecutionBanner } from "./ui.js";
import { createUsageManager } from "./usage.js";

const REAL_CODEX_CMD = "codex";

type MenuChoice =
  | "use"
  | "add"
  | "delete"
  | "rename"
  | "launch"
  | "refresh_usage"
  | "exit";

const usageManager = createUsageManager();

// Global diagnostics: capture and log otherwise-silent exits so we can debug
// situations where the process terminates without a visible stack trace.
process.on("uncaughtException", (err: Error) => {
  try {
    console.error(
      "Fatal: uncaught exception:",
      err && err.stack ? err.stack : err
    );
  } catch (e) {
    // best-effort
    console.error("Fatal: uncaught exception (could not format error)");
  }
  // still exit with non-zero code to signal failure
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  try {
    console.error("Unhandled promise rejection:", reason);
  } catch (e) {
    console.error("Unhandled promise rejection (could not format reason)");
  }
});

process.on("exit", (code) => {
  // Log to stderr so the terminal shows that we exited and with what code.
  console.error(`Process exiting with code ${code}`);
});

interface PromptHandle {
  promise: Promise<MenuChoice>;
  cancel: () => void;
  /**
   * Attempt to refresh/redraw the inquirer prompt UI after we've rewritten
   * the screen above it. This is best-effort and guarded so it won't throw
   * if internals aren't present.
   */
  refresh?: () => void;
}

interface UsageUpdateHandle {
  promise: Promise<void>;
  cancel: () => void;
}

function startMainMenuPrompt(): PromptHandle {
  const choices: Array<{ name: string; value: MenuChoice }> = [
    { name: "Use / activate a profile", value: "use" },
    { name: "Add a new profile", value: "add" },
    { name: "Delete a profile", value: "delete" },
    { name: "Rename a profile", value: "rename" },
    { name: "Launch Codex TUI for active profile", value: "launch" },
    { name: "Invalidate usage cache & refresh", value: "refresh_usage" },
    { name: "Exit", value: "exit" },
  ];

  const prompt = inquirer.prompt<{ choice: MenuChoice }>({
    type: "list",
    name: "choice",
    message: chalk.cyan("What would you like to do?"),
    choices,
    loop: false,
    pageSize: choices.length,
  });

  let closed = false;
  const cancel = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    const ui = prompt.ui;
    if (ui && typeof ui.close === "function") {
      ui.close();
    }
    // Do not close or pause the underlying readline instance here. Closing
    // the rl can terminate the process or leave the TTY in a bad state. Let
    // inquirer handle the rl lifecycle when the prompt resolves.
  };

  const refresh = (): void => {
    const ui = prompt.ui as any | undefined;
    try {
      if (!ui) return;
      // inquirer internals may expose a render method
      if (typeof ui.render === "function") {
        ui.render();
        return;
      }
      // some versions use a private _prompt or rl with a refresh facility
      if (ui._prompt && typeof ui._prompt.render === "function") {
        ui._prompt.render();
        return;
      }
      if (ui.rl && typeof ui.rl.render === "function") {
        ui.rl.render();
        return;
      }
      // as a fallback, attempt to re-print the prompt line(s) by writing a
      // single newline to trigger terminal redraw — best-effort only.
      if (ui.rl && ui.rl.output && typeof ui.rl.output.write === "function") {
        ui.rl.output.write("");
      }
    } catch (e) {
      // swallow; refresh is best-effort
    }
  };

  const promise = prompt
    .then((answer: { choice: MenuChoice }) => {
      closed = true;
      return answer.choice;
    })
    .catch((error: unknown) => {
      closed = true;
      throw error;
    });

  return { promise, cancel, refresh };
}

async function chooseProfile(promptMessage: string): Promise<string | null> {
  const config = loadConfig();
  const names = Object.keys(config.accounts).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    console.log(
      chalk.yellow("No profiles exist. Use 'Add a new profile' first.")
    );
    return null;
  }

  const answer = await inquirer.prompt<{ name: string | null }>({
    type: "list",
    name: "name",
    message: promptMessage,
    choices: [
      ...names,
      new inquirer.Separator(),
      { name: "Cancel", value: null },
    ],
  });
  return answer.name;
}

async function promptForName(
  message: string,
  defaultValue = ""
): Promise<string> {
  const answer = await inquirer.prompt<{ value: string }>({
    type: "input",
    name: "value",
    message,
    default: defaultValue,
    validate: (input: string) =>
      input && input.trim().length > 0 ? true : "Please provide a name.",
  });
  return answer.value.trim();
}

function collectAccounts(
  config: AccountsConfig
): Array<{ name: string; record: AccountRecord }> {
  return Object.entries(config.accounts).map(([name, record]) => ({
    name,
    record,
  }));
}

async function doAdd(): Promise<string> {
  const name = await promptForName("New profile name:");
  const config = loadConfig();
  const authFilePath = getAuthFilePath(name);
  if (config.accounts[name]) {
    const overwrite = await inquirer.prompt<{ ok: boolean }>({
      type: "confirm",
      name: "ok",
      message: `Profile '${name}' already exists. Overwrite?`,
      default: false,
    });
    if (!overwrite.ok) {
      return chalk.dim("Add cancelled.");
    }
  }

  if (fs.existsSync(authFilePath)) {
    fs.rmSync(authFilePath, { force: true });
  }
  usageManager.removeAccount(name);
  config.accounts[name] = { authFile: authFilePath };
  const previousActive = config.active;
  config.active = name;
  saveConfig(config);

  usageManager.refreshAccounts([{ name, authFile: authFilePath }], {
    force: true,
    pruneMissing: false,
  });

  return `${chalk.green(
    `Added '${name}' and set as active. (Previous: ${previousActive ?? "none"})`
  )} ${chalk.dim("Next: run login inside the context or launch Codex TUI.")}`;
}

async function doUse(): Promise<string> {
  const name = await chooseProfile("Select profile to activate:");
  if (!name) {
    return chalk.dim("Activation cancelled.");
  }
  const config = loadConfig();
  config.active = name;
  saveConfig(config);
  return chalk.green(`Activated '${name}'.`);
}

async function doDelete(): Promise<string> {
  const name = await chooseProfile("Select profile to delete:");
  if (!name) {
    return chalk.dim("Deletion cancelled.");
  }
  const config = loadConfig();
  const account = config.accounts[name];
  const authFilePath = account.authFile;

  const confirm = await inquirer.prompt<{ ok: boolean }>({
    type: "confirm",
    name: "ok",
    message: `Permanently delete '${name}' and its auth file (${authFilePath})?`,
    default: false,
  });

  if (!confirm.ok) {
    return chalk.dim("Deletion cancelled.");
  }

  try {
    if (fs.existsSync(authFilePath)) {
      fs.rmSync(authFilePath, { force: true });
    }
    delete config.accounts[name];
    if (config.active === name) {
      config.active = null;
    }
    const remaining = Object.keys(config.accounts);
    if (!config.active && remaining.length > 0) {
      config.active = remaining[0];
    }
    saveConfig(config);
    usageManager.removeAccount(name);
    return chalk.green(`Deleted '${name}'.`);
  } catch (error) {
    const err = error as Error;
    return chalk.red(`Failed to delete '${name}': ${err.message}`);
  }
}

async function doRename(): Promise<string> {
  const oldName = await chooseProfile("Select profile to rename:");
  if (!oldName) {
    return chalk.dim("Rename cancelled.");
  }
  const newName = await promptForName("New name for profile:", oldName);
  if (newName === oldName) {
    return chalk.yellow("Name unchanged.");
  }

  const config = loadConfig();
  if (config.accounts[newName]) {
    return chalk.red(`A profile named '${newName}' already exists.`);
  }

  const oldRecord = config.accounts[oldName];
  const newAuthPath = getAuthFilePath(newName);

  try {
    if (fs.existsSync(oldRecord.authFile)) {
      fs.renameSync(oldRecord.authFile, newAuthPath);
    }
  } catch (error) {
    const err = error as Error;
    return chalk.red(`Failed to rename auth file: ${err.message}`);
  }

  delete config.accounts[oldName];
  config.accounts[newName] = { authFile: newAuthPath };
  if (config.active === oldName) {
    config.active = newName;
  }
  saveConfig(config);

  usageManager.renameAccount(oldName, newName);
  usageManager.refreshAccounts([{ name: newName, authFile: newAuthPath }], {
    force: true,
    pruneMissing: false,
  });

  return chalk.green(`Renamed '${oldName}' → '${newName}'.`);
}

async function doLaunch(): Promise<string | null> {
  const config = loadConfig();
  if (!config.active || !config.accounts[config.active]) {
    return chalk.yellow("No active profile. Activate one first.");
  }
  console.error(chalk.dim("\nLaunching Codex TUI... (Ctrl+C to quit)"));
  await runCodex([]);
  return null;
}

async function runCodex(args: string[]): Promise<void> {
  const config = loadConfig();
  const activeName = config.active;

  if (!activeName || !config.accounts[activeName]) {
    console.error(chalk.red(`\nNo active account set.`));
    console.log(`1. Run ${chalk.cyan("ccx add <name>")} to create a context.`);
    console.log(`2. Run ${chalk.cyan("ccx use <name>")} to activate it.`);
    process.exit(1);
  }

  const account = config.accounts[activeName];
  const accountsList = collectAccounts(config).map(({ name, record }) => ({
    name,
    authFile: record.authFile,
  }));
  const usageEntry = usageManager.getSummary(activeName);
  const activeStatus = getAuthStatus(account.authFile);

  renderExecutionBanner(
    activeName,
    activeStatus,
    SHARED_CODEX_HOME,
    usageEntry
  );

  try {
    hydrateActiveAuth(account.authFile);
  } catch (error) {
    const err = error as Error;
    console.error(chalk.red(`\n${err.message}`));
  }

  usageManager
    .refreshAccounts(accountsList, { pruneMissing: true })
    .catch((error) => {
      const err = error as Error;
      console.warn(`Usage refresh failed: ${err.message}`);
    });

  const child = spawn(REAL_CODEX_CMD, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      CODEX_HOME: SHARED_CODEX_HOME,
    },
  });

  child.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      console.error(
        chalk.red(
          `\nError: Could not find the original '${REAL_CODEX_CMD}' command.`
        )
      );
      console.error(
        chalk.yellow(
          "Ensure you have installed the official OpenAI Codex CLI globally."
        )
      );
    } else {
      console.error(
        chalk.red(`\nFailed to start codex process: ${error.message}`)
      );
    }
    process.exit(1);
  });

  child.on("close", (code) => {
    try {
      persistActiveAuth(account.authFile);
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red(`\n${err.message}`));
    }
    process.exit(code ?? 0);
  });
}

async function mainTuiLoop(): Promise<void> {
  console.error("mainTuiLoop: starting");
  let lastActionMessage: string | null = null;
  let usageResolvers: Array<() => void> = [];

  const unsubscribe = usageManager.onUpdate(() => {
    console.error("mainTuiLoop: usageManager.onUpdate fired");
    const pending = usageResolvers;
    usageResolvers = [];
    for (const resolve of pending) {
      try {
        resolve();
      } catch (error) {
        const err = error as Error;
        console.warn(`Usage update listener failed: ${err.message}`);
      }
    }
  });

  const waitForUsageUpdate = (): UsageUpdateHandle => {
    let active = true;
    let resolverRef: (() => void) | null = null;
    const promise = new Promise<void>((resolve) => {
      resolverRef = () => {
        if (!active) {
          return;
        }
        active = false;
        resolve();
      };
      usageResolvers.push(resolverRef);
    });
    const cancel = () => {
      if (!active || !resolverRef) {
        return;
      }
      active = false;
      usageResolvers = usageResolvers.filter((fn) => fn !== resolverRef);
    };
    return { promise, cancel };
  };

  try {
    while (true) {
      const config = loadConfig();
      const accountsList = collectAccounts(config).map(({ name, record }) => ({
        name,
        authFile: record.authFile,
      }));
      const usageByAccount = usageManager.getAllSummaries(config.accounts);
      const statusByAccount = Object.fromEntries(
        accountsList.map(({ name, authFile }) => [
          name,
          getAuthStatus(authFile),
        ])
      );
      const activeStatus: "Authenticated" | "Unauthenticated" | "No profile" =
        config.active
          ? getAuthStatus(config.accounts[config.active].authFile)
          : "No profile";

      renderDashboard({
        config,
        activeStatus,
        statusByAccount,
        usageByAccount,
        lastAction: lastActionMessage,
      });
      lastActionMessage = null;

      const usageWait = waitForUsageUpdate();
      usageManager
        .refreshAccounts(accountsList, { pruneMissing: true })
        .catch((error) => {
          const err = error as Error;
          console.warn(`Usage refresh failed: ${err.message}`);
        });

      const promptHandle = startMainMenuPrompt();
      const menuResult = promptHandle.promise
        .then<MenuChoice | { type: "prompt_error"; error: unknown }>(
          (choice) => choice
        )
        .catch((error: unknown) => ({ type: "prompt_error" as const, error }));

      const raceResult = await Promise.race([
        menuResult,
        usageWait.promise.then(() => ({ type: "usage_update" as const })),
      ]);

      if (typeof raceResult === "object" && "type" in raceResult) {
        if (raceResult.type === "usage_update") {
          console.error(
            "mainTuiLoop: usage_update received — redrawing dashboard and refreshing prompt"
          );
          usageWait.cancel();
          lastActionMessage = chalk.green("Usage cache refreshed.");

          // inner loop: keep redrawing while usage updates arrive
          while (true) {
            let freshConfig: AccountsConfig | null = null;
            let freshAccountsList: Array<{ name: string; authFile: string }> =
              accountsList;
            let freshUsageByAccount: Record<
              string,
              | (import("./usage.js").UsageEntry & {
                  ageMs: number;
                  stale: boolean;
                })
              | null
            > = usageByAccount;
            let freshStatusByAccount: Record<
              string,
              "Authenticated" | "Unauthenticated"
            > = statusByAccount;
            let freshActiveStatus:
              | "Authenticated"
              | "Unauthenticated"
              | "No profile" = activeStatus;
            try {
              freshConfig = loadConfig();
              freshAccountsList = collectAccounts(freshConfig).map(
                ({ name, record }) => ({
                  name,
                  authFile: record.authFile,
                })
              );
              freshUsageByAccount = usageManager.getAllSummaries(
                freshConfig.accounts
              );
              freshStatusByAccount = Object.fromEntries(
                freshAccountsList.map(({ name, authFile }) => [
                  name,
                  getAuthStatus(authFile),
                ])
              );
              freshActiveStatus = freshConfig.active
                ? getAuthStatus(
                    freshConfig.accounts[freshConfig.active].authFile
                  )
                : "No profile";

              renderDashboard({
                config: freshConfig,
                activeStatus: freshActiveStatus,
                statusByAccount: freshStatusByAccount,
                usageByAccount: freshUsageByAccount,
                lastAction: lastActionMessage,
              });

              try {
                promptHandle.refresh?.();
              } catch (e) {
                // ignore; refresh is best-effort
              }
            } catch (e) {
              console.warn(`In-place refresh failed: ${(e as Error).message}`);
            }

            // Wait for either the menu to resolve or another usage update
            const next = await Promise.race([
              menuResult,
              waitForUsageUpdate().promise.then(() => ({
                type: "usage_update" as const,
              })),
            ]).catch((err) => ({ type: "prompt_error" as const, error: err }));

            if (typeof next === "object" && "type" in next) {
              if (next.type === "usage_update") {
                // another update arrived; loop and redraw again
                continue;
              }
              if (next.type === "prompt_error") {
                usageWait.cancel();
                if ((next.error as { isTtyError?: boolean })?.isTtyError) {
                  throw next.error;
                }
                // otherwise break out to outer loop and re-render there
                break;
              }
            }

            // next is the menu choice — process it below by reusing the
            // existing switch logic. We'll assign to a local variable and
            // run the switch, then continue the outer loop.
            const choice = next as MenuChoice;

            switch (choice) {
              case "add":
                lastActionMessage = await doAdd();
                break;
              case "use":
                lastActionMessage = await doUse();
                break;
              case "delete":
                lastActionMessage = await doDelete();
                break;
              case "rename":
                lastActionMessage = await doRename();
                break;
              case "launch":
                lastActionMessage = await doLaunch();
                if (!lastActionMessage) {
                  console.error(
                    "mainTuiLoop: exiting because launch returned (child started)"
                  );
                  unsubscribe();
                  return;
                }
                break;
              case "refresh_usage":
                usageManager.invalidateCache();
                usageManager
                  .refreshAccounts(freshAccountsList, {
                    force: true,
                    pruneMissing: true,
                  })
                  .catch((error) => {
                    const err = error as Error;
                    console.warn(`Usage refresh failed: ${err.message}`);
                  });
                lastActionMessage = chalk.green(
                  "Usage cache cleared. Refresh scheduled."
                );
                break;
              case "exit":
              default:
                console.error(
                  "mainTuiLoop: exit choice selected - exiting loop"
                );
                clearScreen();
                console.log(chalk.dim("Goodbye."));
                unsubscribe();
                return;
            }

            // after handling the user's choice, pause briefly then continue
            await new Promise((resolve) => setTimeout(resolve, 100));
            // processed the choice; continue outer loop to re-render normally
            break;
          }

          continue;
        }
        if (raceResult.type === "prompt_error") {
          console.error(
            "mainTuiLoop: prompt_error received",
            (raceResult.error as any)?.message ?? raceResult.error
          );
          usageWait.cancel();
          if ((raceResult.error as { isTtyError?: boolean })?.isTtyError) {
            throw raceResult.error;
          }
          continue;
        }
      }

      usageWait.cancel();
      const choice = raceResult as MenuChoice;

      switch (choice) {
        case "add":
          lastActionMessage = await doAdd();
          break;
        case "use":
          lastActionMessage = await doUse();
          break;
        case "delete":
          lastActionMessage = await doDelete();
          break;
        case "rename":
          lastActionMessage = await doRename();
          break;
        case "launch":
          lastActionMessage = await doLaunch();
          if (!lastActionMessage) {
            console.error(
              "mainTuiLoop: exiting because launch returned (child started)"
            );
            unsubscribe();
            return;
          }
          break;
        case "refresh_usage":
          usageManager.invalidateCache();
          usageManager
            .refreshAccounts(accountsList, { force: true, pruneMissing: true })
            .catch((error) => {
              const err = error as Error;
              console.warn(`Usage refresh failed: ${err.message}`);
            });
          lastActionMessage = chalk.green(
            "Usage cache cleared. Refresh scheduled."
          );
          break;
        case "exit":
        default:
          console.error("mainTuiLoop: exit choice selected - exiting loop");
          clearScreen();
          console.log(chalk.dim("Goodbye."));
          unsubscribe();
          return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    unsubscribe();
  }
}

async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  if (userArgs.length > 0) {
    await runCodex(userArgs);
  } else {
    try {
      await mainTuiLoop();
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red(`Fatal error: ${err.message}`));
      process.exit(1);
    }
  }
}

void main();
