import os from "os";
import path from "path";

export const CONFIG_ROOT = path.join(os.homedir(), ".codex_switcher");
export const CONFIG_FILE = path.join(CONFIG_ROOT, "accounts.json");
export const ACCOUNTS_ROOT = path.join(os.homedir(), ".codex_accounts");
export const SHARED_CODEX_HOME = path.join(CONFIG_ROOT, "shared_codex_home");
export const ACTIVE_AUTH_FILE = path.join(SHARED_CODEX_HOME, "auth.json");
