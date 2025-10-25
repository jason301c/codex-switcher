#!/usr/bin/env node

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import chalk from "chalk";
import inquirer from "inquirer";
import {
  clearScreen,
  renderDashboard,
  renderExecutionBanner,
} from "./cli_ui.js";

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

// --- TUI Implementation (interactive menu using inquirer) ---

async function promptMainMenu() {
  const choices = [
    { name: "Use / activate a profile", value: "use" },
    { name: "Add a new profile", value: "add" },
    { name: "Delete a profile", value: "delete" },
    { name: "Rename a profile", value: "rename" },
    { name: "Launch Codex TUI for active profile", value: "launch" },
    { name: "Exit", value: "exit" },
  ];

  const ans = await inquirer.prompt({
    type: "list",
    name: "choice",
    message: chalk.cyan("What would you like to do?"),
    choices,
    loop: false,
    pageSize: choices.length,
  });

  return ans.choice;
}

async function chooseProfile(promptMessage) {
  const config = loadConfig();
  const names = Object.keys(config.accounts).sort();
  if (names.length === 0) {
    console.log(
      chalk.yellow("No profiles exist. Use 'Add a new profile' first.")
    );
    return null;
  }

  const ans = await inquirer.prompt({
    type: "list",
    name: "name",
    message: promptMessage,
    choices: [
      ...names,
      new inquirer.Separator(),
      { name: "Cancel", value: null },
    ],
  });
  return ans.name;
}

async function promptForName(message, defaultVal = "") {
  const ans = await inquirer.prompt({
    type: "input",
    name: "value",
    message,
    default: defaultVal,
    validate: (v) =>
      v && v.trim().length > 0 ? true : "Please provide a name.",
  });
  return ans.value.trim();
}

async function doAdd() {
  const name = await promptForName("New profile name:");
  const config = loadConfig();
  const accountPath = path.join(ACCOUNTS_ROOT, name);
  if (config.accounts[name]) {
    const overwrite = await inquirer.prompt({
      type: "confirm",
      name: "ok",
      message: `Profile '${name}' already exists. Overwrite?`,
      default: false,
    });
    if (!overwrite.ok) return chalk.dim("Add cancelled.");
  }

  fs.mkdirSync(accountPath, { recursive: true });
  config.accounts[name] = accountPath;
  const prev = config.active;
  config.active = name;
  saveConfig(config);
  return `${chalk.green(
    `Added '${name}' and set as active. (Previous: ${prev || "none"})`
  )} ${chalk.dim("Next: run login inside the context or launch Codex TUI.")}`;
}

async function doUse() {
  const name = await chooseProfile("Select profile to activate:");
  if (!name) return chalk.dim("Activation cancelled.");
  const config = loadConfig();
  config.active = name;
  saveConfig(config);
  return chalk.green(`Activated '${name}'.`);
}

async function doDelete() {
  const name = await chooseProfile("Select profile to delete:");
  if (!name) return chalk.dim("Deletion cancelled.");
  const config = loadConfig();
  const accountPath = config.accounts[name];
  const confirm = await inquirer.prompt({
    type: "confirm",
    name: "ok",
    message: `Permanently delete '${name}' and its directory (${accountPath})?`,
    default: false,
  });
  if (!confirm.ok) return chalk.dim("Deletion cancelled.");

  try {
    fs.rmSync(accountPath, { recursive: true, force: true });
    delete config.accounts[name];
    if (config.active === name) config.active = null;
    // auto-select another if available
    const remaining = Object.keys(config.accounts);
    if (!config.active && remaining.length > 0) config.active = remaining[0];
    saveConfig(config);
    return chalk.green(`Deleted '${name}'.`);
  } catch (e) {
    return chalk.red(`Failed to delete '${name}': ${e.message}`);
  }
}

async function doRename() {
  const oldName = await chooseProfile("Select profile to rename:");
  if (!oldName) return chalk.dim("Rename cancelled.");
  const newName = await promptForName("New name for profile:", oldName);
  if (newName === oldName) {
    return chalk.yellow("Name unchanged.");
  }
  const config = loadConfig();
  if (config.accounts[newName]) {
    return chalk.red(`A profile named '${newName}' already exists.`);
  }
  const oldPath = config.accounts[oldName];
  const newPath = path.join(ACCOUNTS_ROOT, newName);
  try {
    fs.renameSync(oldPath, newPath);
  } catch (e) {
    return chalk.red(`Failed to rename directory: ${e.message}`);
  }
  delete config.accounts[oldName];
  config.accounts[newName] = newPath;
  if (config.active === oldName) config.active = newName;
  saveConfig(config);
  return chalk.green(`Renamed '${oldName}' → '${newName}'.`);
}

async function doLaunch() {
  const config = loadConfig();
  if (!config.active || !config.accounts[config.active]) {
    return chalk.yellow("No active profile. Activate one first.");
  }
  console.error(chalk.dim("\nLaunching Codex TUI... (Ctrl+C to quit)"));
  runCodex([]);
}

async function mainTuiLoop() {
  let lastActionMessage = null;
  while (true) {
    const latestConfig = loadConfig();
    renderDashboard(latestConfig, getAuthStatus, {
      lastAction: lastActionMessage,
    });
    lastActionMessage = null;

    const choice = await promptMainMenu();
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
          return; // launching codex replaces process
        }
        break;
      case "exit":
      default:
        clearScreen();
        console.log(chalk.dim("Goodbye."));
        return;
    }

    // brief pause for readability
    await new Promise((r) => setTimeout(r, 100));
  }
}

// --- Entry point: passthrough when args supplied, else show TUI ---

const userArgs = process.argv.slice(2);
if (userArgs.length > 0) {
  // simply passthrough to the original codex binary
  runCodex(userArgs);
} else {
  // Launch interactive TUI
  (async () => {
    try {
      await mainTuiLoop();
    } catch (e) {
      console.error(chalk.red(`Fatal error: ${e.message}`));
      process.exit(1);
    }
  })();
}
