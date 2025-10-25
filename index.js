#!/usr/bin/env node

import { program } from "commander";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import chalk from "chalk";
import readline from "readline/promises";
import { renderExecutionBanner, renderAccountList } from "./cli_ui.js";

// --- Configuration and Utilities ---

// Define where the wrapper stores its own configuration
const CONFIG_ROOT = path.join(os.homedir(), ".codex_switcher");
const CONFIG_FILE = path.join(CONFIG_ROOT, "accounts.json");

// Define where the actual Codex configuration files (auth.json, config.toml)
// will be stored for each account. This is the directory that will be assigned to CODEX_HOME.
const ACCOUNTS_ROOT = path.join(os.homedir(), ".codex_accounts");

const REAL_CODEX_CMD = "codex";

/**
 * Ensures the necessary directories and config files exist.
 */
function initializeConfig() {
  if (!fs.existsSync(CONFIG_ROOT)) {
    fs.mkdirSync(CONFIG_ROOT, { recursive: true });
  }
  if (!fs.existsSync(ACCOUNTS_ROOT)) {
    fs.mkdirSync(ACCOUNTS_ROOT, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    const initialConfig = { active: null, accounts: {} };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2));
  }
}

/**
 * Loads the accounts configuration.
 */
function loadConfig() {
  initializeConfig();
  try {
    const data = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    console.error(
      chalk.red(`Error reading configuration file ${CONFIG_FILE}: ${e.message}`)
    );
    process.exit(1);
  }
}

/**
 * Saves the accounts configuration.
 */
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * Checks if the authentication file exists for a given profile path.
 * Returns plain string status (to be formatted by UI renderers).
 */
function getAuthStatus(accountPath) {
  if (fs.existsSync(path.join(accountPath, "auth.json"))) {
    return "Authenticated";
  }
  return "Unauthenticated";
}

// --- Core Execution Logic ---

/**
 * Executes the real 'codex' binary with the appropriate CODEX_HOME environment variable.
 * Handles the spawning and process management.
 */
function runCodex(args) {
  const config = loadConfig();
  const activeName = config.active;

  if (!activeName || !config.accounts[activeName]) {
    console.error(chalk.red(`\nNo active account set.`));
    console.log(`1. Run ${chalk.cyan("ccx add <name>")} to create a context.`);
    console.log(`2. Run ${chalk.cyan("ccx use <name>")} to activate it.`);
    process.exit(1);
  }

  const codexHomePath = config.accounts[activeName];

  // Output profile status using the custom UI banner
  renderExecutionBanner(
    activeName,
    getAuthStatus(codexHomePath),
    codexHomePath
  );

  // Prepare environment variables for the child process
  const env = {
    ...process.env,
    CODEX_HOME: codexHomePath,
  };

  // Spawn the original codex executable
  const child = spawn(REAL_CODEX_CMD, args, {
    stdio: "inherit",
    env: env,
  });

  child.on("error", (err) => {
    if (err.code === "ENOENT") {
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
        chalk.red(`\nFailed to start codex process: ${err.message}`)
      );
    }
    process.exit(1);
  });

  child.on("close", (code) => {
    process.exit(code || 0);
  });
}

// --- Commands Definition ---

program
  .version("1.0.0")
  .description("Codex Account Context Switcher (CLI Wrapper)")
  .allowUnknownOption(true)
  .allowExcessArguments(true);

// Update known subcommands list. Include 'help' so that 'ccx help' is handled by
// commander (the wrapper) instead of being passed through to the real codex
// binary.
const knownSubcommands = ["use", "list", "add", "delete", "rename", "help"];

// Command: ccx use <name>
program
  .command("use <name>")
  .description(
    "Switch to a specific Codex account context and optionally launch Codex TUI"
  )
  .action(async (name) => {
    const config = loadConfig();
    if (!config.accounts[name]) {
      console.error(chalk.red(`Error: Account '${name}' does not exist.`));
      process.exit(1);
    }

    const oldActive = config.active;
    config.active = name;
    saveConfig(config);

    console.log(
      chalk.green(
        `Switched active account from '${oldActive || "[none]"}' to '${name}'.`
      )
    );

    const authStatus = getAuthStatus(config.accounts[name]);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (authStatus === "Unauthenticated") {
      console.log(
        chalk.yellow(
          `\nWarning: Profile '${name}' is currently unauthenticated.`
        )
      );
      console.log(
        `Run ${chalk.cyan("ccx login chatgpt")} or ${chalk.cyan(
          "ccx login --with-api-key"
        )} inside this context to authenticate.`
      );
    }

    const answer = await rl.question(
      chalk.cyan(`\nLaunch Codex TUI now? (Y/n): `)
    );
    rl.close();

    if (answer.toLowerCase() !== "n") {
      console.error(
        chalk.dim("\nLaunching Codex TUI... (Ctrl+C to quit the session)")
      );
      runCodex([]);
    } else {
      process.exit(0);
    }
  });

// Command: ccx list
program
  .command("list")
  .description("List all configured accounts and their status")
  .action(() => {
    const config = loadConfig();
    renderAccountList(config, getAuthStatus);
  });

// Command: ccx add <name>
program
  .command("add <name>")
  .description("Add a new account context (creates a new CODEX_HOME directory)")
  .option("-f, --force", "Overwrite existing account name if it exists")
  .action((name, options) => {
    const config = loadConfig();
    const accountPath = path.join(ACCOUNTS_ROOT, name);

    if (config.accounts[name] && !options.force) {
      console.error(
        chalk.red(
          `Error: Account '${name}' already exists at ${accountPath}. Use -f to overwrite.`
        )
      );
      process.exit(1);
    }

    fs.mkdirSync(accountPath, { recursive: true });

    config.accounts[name] = accountPath;
    const wasActive = config.active;
    config.active = name;
    saveConfig(config);

    console.log(chalk.green(`\nAccount '${name}' added and set as active.`));
    if (wasActive) {
      console.log(chalk.dim(`(Previous active account: ${wasActive})`));
    }

    console.log(
      chalk.yellow(
        `\nNext step: Run ${chalk.cyan(
          "ccx login"
        )} to authenticate this new context.`
      )
    );
  });

// Command: ccx delete <name>
program
  .command("delete <name>")
  .description("Delete a profile and its associated configuration directory")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (name, options) => {
    const config = loadConfig();
    if (!config.accounts[name]) {
      console.error(chalk.red(`Error: Account '${name}' does not exist.`));
      process.exit(1);
    }

    const accountPath = config.accounts[name];
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (!options.yes) {
      const answer = await rl.question(
        chalk.red.bold(
          `\nWARNING: This will permanently delete profile '${name}' and its directory (${accountPath}). Continue? (y/N): `
        )
      );
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log(chalk.yellow("Deletion cancelled."));
        process.exit(0);
      }
    } else {
      rl.close();
    }

    // 1. Remove the directory
    try {
      fs.rmSync(accountPath, { recursive: true, force: true });
      delete config.accounts[name];
      console.log(
        chalk.green(
          `Successfully deleted configuration directory: ${accountPath}`
        )
      );
    } catch (e) {
      console.error(chalk.red(`Error deleting directory: ${e.message}`));
      process.exit(1);
    }

    // 2. Update active profile if the deleted one was active
    if (config.active === name) {
      config.active = null;
      console.log(chalk.yellow(`Deactivated profile '${name}'.`));

      const remainingNames = Object.keys(config.accounts);
      if (remainingNames.length > 0) {
        // Auto-select the first available profile as the new active one
        config.active = remainingNames[0];
        console.log(
          chalk.green(
            `Automatically set '${config.active}' as the new active profile.`
          )
        );
      }
    }

    saveConfig(config);
    console.log(chalk.green(`Profile '${name}' successfully removed.`));
    process.exit(0);
  });

// Command: ccx rename <oldName> <newName>
program
  .command("rename <oldName> <newName>")
  .description("Rename an existing profile")
  .action((oldName, newName) => {
    const config = loadConfig();

    if (!config.accounts[oldName]) {
      console.error(chalk.red(`Error: Profile '${oldName}' does not exist.`));
      process.exit(1);
    }
    if (config.accounts[newName]) {
      console.error(
        chalk.red(`Error: Profile '${newName}' already exists. Cannot rename.`)
      );
      process.exit(1);
    }

    const oldPath = config.accounts[oldName];
    const newPath = path.join(ACCOUNTS_ROOT, newName);

    // 1. Rename the physical directory
    try {
      fs.renameSync(oldPath, newPath);
    } catch (e) {
      console.error(
        chalk.red(
          `Error renaming directory from ${oldName} to ${newName}: ${e.message}`
        )
      );
      process.exit(1);
    }

    // 2. Update the config mapping
    delete config.accounts[oldName];
    config.accounts[newName] = newPath;

    // 3. Update active profile pointer if necessary
    if (config.active === oldName) {
      config.active = newName;
    }

    saveConfig(config);
    console.log(
      chalk.green(
        `Profile successfully renamed from '${oldName}' to '${newName}'.`
      )
    );
    process.exit(0);
  });

// --- Passthrough Logic ---

const userArgs = process.argv.slice(2);
const firstArg = userArgs[0];

if (firstArg && !knownSubcommands.includes(firstArg)) {
  // Passthrough command (e.g., ccx login chatgpt, ccx exec, ccx sandbox)
  runCodex(userArgs);
} else {
  program.parse(process.argv);
}

// Handle the case where the user runs 'ccx' with no arguments
if (userArgs.length === 0) {
  const config = loadConfig();
  if (config.active && config.accounts[config.active]) {
    // If an account is active, run the default 'codex' command (TUI)
    console.error(chalk.dim("\nLaunching Codex TUI for active account..."));
    runCodex([]);
  } else {
    // If no active account, show wrapper help
    console.log(
      chalk.bold.yellow(
        "No active account. Please use 'ccx list' or 'ccx add <name>'."
      )
    );
    program.help({ error: true });
  }
}
