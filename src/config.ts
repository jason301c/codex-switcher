import fs from "fs";
import path from "path";
import {
  ACCOUNTS_ROOT,
  CONFIG_FILE,
  CONFIG_ROOT,
  SHARED_CODEX_HOME,
} from "./paths.js";

export interface AccountRecord {
  authFile: string;
}

export interface AccountsConfig {
  active: string | null;
  accounts: Record<string, AccountRecord>;
}

function ensureDirectory(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

export function initializeConfig(): void {
  ensureDirectory(CONFIG_ROOT);
  ensureDirectory(ACCOUNTS_ROOT);
  ensureDirectory(path.dirname(CONFIG_FILE));
  // Ensure the shared codex home exists so later operations (hydrate/persist)
  // that copy into ACTIVE_AUTH_FILE won't fail with ENOENT.
  ensureDirectory(SHARED_CODEX_HOME);

  if (!fs.existsSync(CONFIG_FILE)) {
    const initialConfig: AccountsConfig = { active: null, accounts: {} };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(initialConfig, null, 2));
  }
}

export function getAuthFilePath(profileName: string): string {
  return path.join(ACCOUNTS_ROOT, `${profileName}.auth.json`);
}

function migrateLegacyAuthDirectory(
  legacyDir: string,
  destinationFile: string
): void {
  const legacyAuthPath = path.join(legacyDir, "auth.json");
  if (!fs.existsSync(legacyAuthPath)) {
    return;
  }

  try {
    fs.copyFileSync(legacyAuthPath, destinationFile);
  } catch (error) {
    const err = error as Error;
    console.warn(
      `Warning: failed to migrate legacy auth from ${legacyAuthPath}: ${err.message}`
    );
  }
}

function normalizeConfig(config: AccountsConfig): AccountsConfig {
  let mutated = false;
  for (const [name, record] of Object.entries(config.accounts)) {
    if (typeof record === "string") {
      const authFile = getAuthFilePath(name);
      migrateLegacyAuthDirectory(record, authFile);
      config.accounts[name] = { authFile };
      mutated = true;
    } else if (!record || typeof record !== "object") {
      config.accounts[name] = { authFile: getAuthFilePath(name) };
      mutated = true;
    } else if (!record.authFile) {
      record.authFile = getAuthFilePath(name);
      mutated = true;
    }
  }

  if (mutated) {
    saveConfig(config);
  }

  return config;
}

export function loadConfig(): AccountsConfig {
  initializeConfig();
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as AccountsConfig;
    return normalizeConfig(parsed);
  } catch (error) {
    const err = error as Error;
    throw new Error(`Failed to read configuration file: ${err.message}`);
  }
}

export function saveConfig(config: AccountsConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getAuthStatus(
  authFilePath: string
): "Authenticated" | "Unauthenticated" {
  return fs.existsSync(authFilePath) ? "Authenticated" : "Unauthenticated";
}

export function listAccounts(
  config: AccountsConfig
): Array<{ name: string; record: AccountRecord }> {
  return Object.entries(config.accounts).map(([name, record]) => ({
    name,
    record,
  }));
}

export function removeAccountFromConfig(
  config: AccountsConfig,
  name: string
): void {
  delete config.accounts[name];
  if (config.active === name) {
    config.active = null;
  }
}
