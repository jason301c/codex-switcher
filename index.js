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

// Store per-profile auth.json snapshots in a flat directory under the home folder.
const ACCOUNTS_ROOT = path.join(os.homedir(), ".codex_accounts");
// Shared CODEX_HOME used for every invocation; the active auth.json is swapped in/out here.
const SHARED_CODEX_HOME = path.join(CONFIG_ROOT, "shared_codex_home");
const ACTIVE_AUTH_FILE = path.join(SHARED_CODEX_HOME, "auth.json");

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
  if (!fs.existsSync(SHARED_CODEX_HOME)) {
    fs.mkdirSync(SHARED_CODEX_HOME, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    const initialConfig = { active: null, accounts: {} };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2));
  }
}

/**
 * Returns the on-disk location for a profile's auth.json snapshot.
 */
function getAuthFilePath(profileName) {
  return path.join(ACCOUNTS_ROOT, `${profileName}.auth.json`);
}

/**
 * Copies a legacy per-profile directory auth.json into the new flat storage.
 */
function migrateLegacyAuth(legacyDir, destAuthPath) {
  const legacyAuth = path.join(legacyDir, "auth.json");
  if (!fs.existsSync(legacyAuth)) {
    return;
  }
  try {
    fs.copyFileSync(legacyAuth, destAuthPath);
  } catch (e) {
    console.error(
      chalk.yellow(
        `Warning: failed to migrate legacy auth from ${legacyAuth}: ${e.message}`
      )
    );
  }
}

/**
 * Normalizes config accounts so each entry is an object with an authFile path.
 * Performs a best-effort migration for legacy directory-based accounts.
 */
function normalizeAccounts(config) {
  let mutated = false;
  for (const [name, entry] of Object.entries(config.accounts)) {
    if (typeof entry === "string") {
      const normalized = { authFile: getAuthFilePath(name) };
      migrateLegacyAuth(entry, normalized.authFile);
      config.accounts[name] = normalized;
      mutated = true;
    } else if (!entry || typeof entry !== "object") {
      config.accounts[name] = { authFile: getAuthFilePath(name) };
      mutated = true;
    } else if (!entry.authFile) {
      entry.authFile = getAuthFilePath(name);
      mutated = true;
    }
  }
  if (mutated) {
    saveConfig(config);
  }
}

/**
 * Loads the accounts configuration.
 */
function loadConfig() {
  initializeConfig();
  try {
    const data = fs.readFileSync(CONFIG_FILE, "utf-8");
    const config = JSON.parse(data);
    normalizeAccounts(config);
    return config;
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
function getAuthStatus(authFilePath) {
  if (fs.existsSync(authFilePath)) {
    return "Authenticated";
  }
  return "Unauthenticated";
}

/**
 * Copies the stored auth.json for a profile into the shared CODEX home.
 */
function hydrateActiveAuth(authFilePath) {
  try {
    if (fs.existsSync(authFilePath)) {
      fs.copyFileSync(authFilePath, ACTIVE_AUTH_FILE);
    } else if (fs.existsSync(ACTIVE_AUTH_FILE)) {
      fs.rmSync(ACTIVE_AUTH_FILE, { force: true });
    }
  } catch (e) {
    console.error(
      chalk.red(`\nFailed to prepare auth file for execution: ${e.message}`)
    );
  }
}

/**
 * Persists the shared CODEX_HOME auth.json back into the profile snapshot.
 */
function persistActiveAuth(authFilePath) {
  try {
    if (fs.existsSync(ACTIVE_AUTH_FILE)) {
      fs.copyFileSync(ACTIVE_AUTH_FILE, authFilePath);
    } else if (fs.existsSync(authFilePath)) {
      fs.rmSync(authFilePath, { force: true });
    }
  } catch (e) {
    console.error(
      chalk.red(`\nFailed to persist auth file after execution: ${e.message}`)
    );
  }
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

  const account = config.accounts[activeName];

  // Output profile status using the custom UI banner
  renderExecutionBanner(
    activeName,
    getAuthStatus(account.authFile),
    SHARED_CODEX_HOME
  );

  hydrateActiveAuth(account.authFile);

  // Prepare environment variables for the child process
  const env = {
    ...process.env,
    CODEX_HOME: SHARED_CODEX_HOME,
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
    persistActiveAuth(account.authFile);
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
  const authFilePath = getAuthFilePath(name);
  if (config.accounts[name]) {
    const overwrite = await inquirer.prompt({
      type: "confirm",
      name: "ok",
      message: `Profile '${name}' already exists. Overwrite?`,
      default: false,
    });
    if (!overwrite.ok) return chalk.dim("Add cancelled.");
  }

  if (fs.existsSync(authFilePath)) {
    fs.rmSync(authFilePath, { force: true });
  }
  config.accounts[name] = { authFile: authFilePath };
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
  const account = config.accounts[name];
  const authFilePath = account.authFile;
  const confirm = await inquirer.prompt({
    type: "confirm",
    name: "ok",
    message: `Permanently delete '${name}' and its auth file (${authFilePath})?`,
    default: false,
  });
  if (!confirm.ok) return chalk.dim("Deletion cancelled.");

  try {
    if (fs.existsSync(authFilePath)) {
      fs.rmSync(authFilePath, { force: true });
    }
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
  const oldRecord = config.accounts[oldName];
  const newAuthPath = getAuthFilePath(newName);
  try {
    if (fs.existsSync(oldRecord.authFile)) {
      fs.renameSync(oldRecord.authFile, newAuthPath);
    }
  } catch (e) {
    return chalk.red(`Failed to rename auth file: ${e.message}`);
  }
  delete config.accounts[oldName];
  config.accounts[newName] = { authFile: newAuthPath };
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
