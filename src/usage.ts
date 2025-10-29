import fs from "fs";
import path from "path";
import { CONFIG_ROOT } from "./paths.js";

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CACHE_FILE_NAME = "usage_cache.json";
const CACHE_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_FETCH_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 5000;

type TokenState =
  | { state: "missing"; message: string }
  | { state: "incomplete"; message: string }
  | { state: "parse_error"; message: string }
  | { state: "ok"; accessToken: string; accountId: string };

type SnapshotState =
  | { state: "ok"; data: UsageResponse }
  | { state: "missing"; message: string }
  | { state: "incomplete"; message: string }
  | { state: "parse_error"; message: string }
  | { state: "error"; message: string };

interface UsageResponse {
  plan_type?: string | null;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: RateWindow;
    secondary_window?: RateWindow;
  };
  credits?: {
    unlimited?: boolean;
    balance?: string | null;
  };
}

interface RateWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
}

export interface UsageSummary {
  status: "ok";
  planType: string | null;
  rateLimit: {
    allowed: boolean | null;
    limitReached: boolean | null;
    primary: NormalizedRateWindow | null;
    secondary: NormalizedRateWindow | null;
  };
  credits: {
    unlimited: boolean | null;
    balance: string | null;
  } | null;
}

export interface UsageMessage {
  status: "warning" | "error";
  message: string;
}

export type UsageSummaryOrMessage = UsageSummary | UsageMessage | null;

export interface UsageEntry {
  summary: UsageSummaryOrMessage;
  fetchedAt: number;
}

export interface UsageManager {
  getSummary(name: string): (UsageEntry & { ageMs: number; stale: boolean }) | null;
  getAllSummaries(
    accounts: Record<string, { authFile: string }>
  ): Record<string, (UsageEntry & { ageMs: number; stale: boolean }) | null>;
  refreshAccounts(
    accounts: Array<{ name: string; authFile: string }>,
    options?: { force?: boolean; pruneMissing?: boolean }
  ): Promise<void>;
  invalidateCache(): void;
  removeAccount(name: string): void;
  renameAccount(oldName: string, newName: string): void;
  onUpdate(listener: () => void): () => void;
}

interface CacheShape {
  version: number;
  entries: Record<
    string,
    {
      summary: UsageSummaryOrMessage;
      fetchedAt: number;
    }
  >;
}

interface NormalizedRateWindow {
  usedPercent: number | null;
  resetAfterSeconds: number | null;
  limitWindowSeconds: number | null;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

function readAuthTokens(authFilePath: string): TokenState {
  if (!authFilePath || !fs.existsSync(authFilePath)) {
    return { state: "missing", message: "auth.json not found for this profile." };
  }

  try {
    const raw = fs.readFileSync(authFilePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      tokens?: { access_token?: string; account_id?: string };
    };
    const accessToken = parsed.tokens?.access_token;
    const accountId = parsed.tokens?.account_id;

    if (!accessToken || !accountId) {
      return {
        state: "incomplete",
        message: "auth.json is missing access_token or account_id.",
      };
    }

    return {
      state: "ok",
      accessToken,
      accountId,
    };
  } catch (error) {
    const err = error as Error;
    return {
      state: "parse_error",
      message: err.message || "Failed to parse auth.json.",
    };
  }
}

async function performUsageRequest(accessToken: string, accountId: string): Promise<SnapshotState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "chatgpt-account-id": accountId,
        "oai-language": "en-US",
        referer: "https://chatgpt.com/codex/settings/usage",
        priority: "u=1, i",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.text();
        if (body) {
          const trimmed = body.length > 140 ? `${body.slice(0, 140)}…` : body;
          detail = `: ${trimmed}`;
        }
      } catch {
        // ignore
      }

      return {
        state: "error",
        message: `Usage request failed (HTTP ${response.status})${detail}`,
      };
    }

    const data = (await response.json()) as UsageResponse;
    return { state: "ok", data };
  } catch (error) {
    const err = error as Error;
    const message =
      err.name === "AbortError"
        ? "Usage request timed out."
        : err.message || "Usage request failed.";
    return { state: "error", message };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUsageSnapshot(authFilePath: string): Promise<SnapshotState> {
  const tokenState = readAuthTokens(authFilePath);
  if (tokenState.state !== "ok") {
    return tokenState;
  }

  return performUsageRequest(tokenState.accessToken, tokenState.accountId);
}

const truncate = (message: string, limit = 160): string =>
  message.length > limit ? `${message.slice(0, limit - 3)}...` : message;

function normalizeRateWindow(window?: RateWindow | null): NormalizedRateWindow | null {
  if (!window) {
    return null;
  }

  return {
    usedPercent: typeof window.used_percent === "number" ? window.used_percent : null,
    resetAfterSeconds:
      typeof window.reset_after_seconds === "number" ? window.reset_after_seconds : null,
    limitWindowSeconds:
      typeof window.limit_window_seconds === "number" ? window.limit_window_seconds : null,
  };
}

function summarizeUsageSnapshot(snapshot: SnapshotState): UsageSummaryOrMessage {
  switch (snapshot.state) {
    case "ok": {
      const rateLimit = snapshot.data.rate_limit ?? {};
      return {
        status: "ok",
        planType: snapshot.data.plan_type ?? null,
        rateLimit: {
          allowed: typeof rateLimit.allowed === "boolean" ? rateLimit.allowed : null,
          limitReached:
            typeof rateLimit.limit_reached === "boolean" ? rateLimit.limit_reached : null,
          primary: normalizeRateWindow(rateLimit.primary_window ?? null),
          secondary: normalizeRateWindow(rateLimit.secondary_window ?? null),
        },
        credits: snapshot.data.credits
          ? {
              unlimited:
                typeof snapshot.data.credits.unlimited === "boolean"
                  ? snapshot.data.credits.unlimited
                  : null,
              balance:
                snapshot.data.credits.balance !== undefined
                  ? snapshot.data.credits.balance
                  : null,
            }
          : null,
      };
    }
    case "missing":
      return { status: "warning", message: snapshot.message };
    case "incomplete":
      return { status: "warning", message: truncate(snapshot.message) };
    case "parse_error":
      return { status: "error", message: `Invalid auth.json: ${truncate(snapshot.message)}` };
    case "error":
      return { status: "error", message: truncate(snapshot.message) };
    default:
      return null;
  }
}

const loadCache = (cacheFile: string): CacheShape => {
  if (!fs.existsSync(cacheFile)) {
    return { version: CACHE_VERSION, entries: {} };
  }

  try {
    const raw = fs.readFileSync(cacheFile, "utf-8");
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed || typeof parsed !== "object") {
      return { version: CACHE_VERSION, entries: {} };
    }
    return {
      version: CACHE_VERSION,
      entries: parsed.entries ?? {},
    };
  } catch (error) {
    const err = error as Error;
    console.warn(`Usage cache could not be read: ${err.message}`);
    return { version: CACHE_VERSION, entries: {} };
  }
};

const saveCache = (cacheFile: string, cache: CacheShape): void => {
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  } catch (error) {
    const err = error as Error;
    console.warn(`Usage cache could not be written: ${err.message}`);
  }
};

const normalizeAccountsList = (
  accounts: Array<{ name: string; authFile: string }>
): Array<{ name: string; authFile: string }> => {
  const map = new Map<string, { name: string; authFile: string }>();
  for (const account of accounts) {
    if (!account || !account.name) {
      continue;
    }
    map.set(account.name, account);
  }
  return Array.from(map.values());
};

export interface UsageManagerOptions {
  cacheTtlMs?: number;
  fetchDelayMs?: number;
}

export function createUsageManager({
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  fetchDelayMs = DEFAULT_FETCH_DELAY_MS,
}: UsageManagerOptions = {}): UsageManager {
  ensureDir(CONFIG_ROOT);
  const cacheFile = path.join(CONFIG_ROOT, CACHE_FILE_NAME);
  let cache = loadCache(cacheFile);
  let inFlight: Promise<void> | null = null;
  let pending:
    | {
        accounts: Array<{ name: string; authFile: string }>;
        force: boolean;
        pruneMissing: boolean;
      }
    | null = null;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        const err = error as Error;
        console.warn(`Usage listener failed: ${err.message}`);
      }
    }
  };

  const pruneMissing = (accountNames: Set<string>): void => {
    let mutated = false;
    for (const existing of Object.keys(cache.entries)) {
      if (!accountNames.has(existing)) {
        delete cache.entries[existing];
        mutated = true;
      }
    }
    if (mutated) {
      saveCache(cacheFile, cache);
      notify();
    }
  };

  const shouldFetch = (name: string, force: boolean): boolean => {
    if (force) {
      return true;
    }
    const entry = cache.entries[name];
    if (!entry) {
      return true;
    }
    const age = Date.now() - entry.fetchedAt;
    return age >= cacheTtlMs;
  };

  const fetchAndStore = async (name: string, authFile: string): Promise<void> => {
    const snapshot = await fetchUsageSnapshot(authFile);
    const summary = summarizeUsageSnapshot(snapshot);
    cache.entries[name] = {
      summary,
      fetchedAt: Date.now(),
    };
    saveCache(cacheFile, cache);
    notify();
  };

  const refreshImpl = async (
    accounts: Array<{ name: string; authFile: string }>,
    force: boolean
  ): Promise<void> => {
    let first = true;
    for (const { name, authFile } of accounts) {
      if (!shouldFetch(name, force)) {
        continue;
      }
      if (!first) {
        await delay(fetchDelayMs);
      }
      first = false;
      try {
        await fetchAndStore(name, authFile);
      } catch (error) {
        const err = error as Error;
        console.warn(`Failed to refresh usage for '${name}': ${err.message}`);
      }
    }
  };

  const enqueueRefresh = (
    accounts: Array<{ name: string; authFile: string }>,
    { force = false, pruneMissing: prune = false }: { force?: boolean; pruneMissing?: boolean }
  ): Promise<void> => {
    const normalized = normalizeAccountsList(accounts);
    if (prune) {
      pruneMissing(new Set(normalized.map((account) => account.name)));
    }
    if (normalized.length === 0) {
      return Promise.resolve();
    }

    const schedule = { accounts: normalized, force, pruneMissing: prune };
    if (inFlight) {
      if (pending) {
        const merged = new Map<string, { name: string; authFile: string }>();
        for (const account of pending.accounts) {
          merged.set(account.name, account);
        }
        for (const account of normalized) {
          merged.set(account.name, account);
        }
        pending = {
          accounts: Array.from(merged.values()),
          force: pending.force || force,
          pruneMissing: pending.pruneMissing || prune,
        };
      } else {
        pending = schedule;
      }
      return inFlight;
    }

    inFlight = refreshImpl(normalized, force)
      .catch((error) => {
        const err = error as Error;
        console.warn(`Usage refresh failed: ${err.message}`);
      })
      .finally(() => {
        inFlight = null;
        if (pending) {
          const next = pending;
          pending = null;
          enqueueRefresh(next.accounts, {
            force: next.force,
            pruneMissing: next.pruneMissing,
          });
        }
      });

    return inFlight;
  };

  const wrapSummary = (entry: UsageEntry | undefined) => {
    if (!entry) {
      return null;
    }
    const ageMs = Date.now() - entry.fetchedAt;
    return {
      ...entry,
      ageMs,
      stale: ageMs >= cacheTtlMs,
    };
  };

  return {
    getSummary(name) {
      return wrapSummary(cache.entries[name]);
    },
    getAllSummaries(accounts) {
      const result: Record<string, (UsageEntry & { ageMs: number; stale: boolean }) | null> = {};
      for (const [name] of Object.entries(accounts)) {
        result[name] = wrapSummary(cache.entries[name]);
      }
      return result;
    },
    async refreshAccounts(accounts, options) {
      await enqueueRefresh(accounts, options ?? {});
    },
    invalidateCache() {
      cache = { version: CACHE_VERSION, entries: {} };
      saveCache(cacheFile, cache);
      notify();
    },
    removeAccount(name) {
      if (cache.entries[name]) {
        delete cache.entries[name];
        saveCache(cacheFile, cache);
        notify();
      }
    },
    renameAccount(oldName, newName) {
      if (oldName === newName) {
        return;
      }
      if (cache.entries[oldName]) {
        cache.entries[newName] = cache.entries[oldName];
        delete cache.entries[oldName];
        saveCache(cacheFile, cache);
        notify();
      }
    },
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
