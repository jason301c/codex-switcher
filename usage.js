import fs from "fs";
import path from "path";

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CACHE_FILE_NAME = "usage_cache.json";
const CACHE_VERSION = 1;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_FETCH_DELAY_MS = 2000; // 2 seconds between calls
const REQUEST_TIMEOUT_MS = 5000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadCache(cacheFile) {
  try {
    if (!fs.existsSync(cacheFile)) {
      return { version: CACHE_VERSION, entries: {} };
    }
    const raw = fs.readFileSync(cacheFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { version: CACHE_VERSION, entries: {} };
    }
    const entries = parsed.entries && typeof parsed.entries === "object"
      ? parsed.entries
      : {};
    return { version: CACHE_VERSION, entries };
  } catch (e) {
    console.warn(
      `Usage cache could not be read (${cacheFile}): ${e.message}`
    );
    return { version: CACHE_VERSION, entries: {} };
  }
}

function saveCache(cacheFile, cache) {
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.warn(`Usage cache could not be written (${cacheFile}): ${e.message}`);
  }
}

function readAuthTokens(authFilePath) {
  if (!authFilePath || !fs.existsSync(authFilePath)) {
    return {
      state: "missing",
      message: "auth.json not found for this profile.",
    };
  }

  try {
    const raw = fs.readFileSync(authFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    const tokens = parsed.tokens || {};
    const accessToken = tokens.access_token;
    const accountId = tokens.account_id;

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
  } catch (e) {
    return {
      state: "parse_error",
      message: e.message || "Failed to parse auth.json.",
    };
  }
}

async function performUsageRequest({ accessToken, accountId }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(USAGE_ENDPOINT, {
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

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.text();
        if (body) {
          const trimmed = body.length > 140 ? `${body.slice(0, 140)}…` : body;
          detail = `: ${trimmed}`;
        }
      } catch (_) {
        // ignore response body parsing failures
      }
      return {
        state: "error",
        message: `Usage request failed (HTTP ${res.status})${detail}`,
      };
    }

    const data = await res.json();
    return { state: "ok", data };
  } catch (e) {
    const message =
      e.name === "AbortError"
        ? "Usage request timed out."
        : e.message || "Usage request failed.";
    return { state: "error", message };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUsageSnapshot(authFilePath) {
  const tokenState = readAuthTokens(authFilePath);
  if (tokenState.state !== "ok") {
    return tokenState;
  }
  return performUsageRequest(tokenState);
}

function summarizeUsageSnapshot(snapshot) {
  const truncate = (msg) =>
    msg && msg.length > 160 ? `${msg.slice(0, 157)}...` : msg;

  if (!snapshot) {
    return null;
  }

  if (snapshot.state === "ok") {
    const rateLimit = snapshot.data?.rate_limit || {};
    const primaryWindow = rateLimit.primary_window || null;
    const secondaryWindow = rateLimit.secondary_window || null;
    const credits = snapshot.data?.credits || null;
    return {
      status: "ok",
      planType: snapshot.data?.plan_type || null,
      rateLimit: {
        allowed:
          typeof rateLimit.allowed === "boolean" ? rateLimit.allowed : null,
        limitReached:
          typeof rateLimit.limit_reached === "boolean"
            ? rateLimit.limit_reached
            : null,
        primary: primaryWindow
          ? {
              usedPercent:
                typeof primaryWindow.used_percent === "number"
                  ? primaryWindow.used_percent
                  : null,
              resetAfterSeconds:
                typeof primaryWindow.reset_after_seconds === "number"
                  ? primaryWindow.reset_after_seconds
                  : null,
              limitWindowSeconds:
                typeof primaryWindow.limit_window_seconds === "number"
                  ? primaryWindow.limit_window_seconds
                  : null,
            }
          : null,
        secondary: secondaryWindow
          ? {
              usedPercent:
                typeof secondaryWindow.used_percent === "number"
                  ? secondaryWindow.used_percent
                  : null,
              resetAfterSeconds:
                typeof secondaryWindow.reset_after_seconds === "number"
                  ? secondaryWindow.reset_after_seconds
                  : null,
              limitWindowSeconds:
                typeof secondaryWindow.limit_window_seconds === "number"
                  ? secondaryWindow.limit_window_seconds
                  : null,
            }
          : null,
      },
      credits: credits
        ? {
            unlimited:
              typeof credits.unlimited === "boolean"
                ? credits.unlimited
                : null,
            balance: credits.balance ?? null,
          }
        : null,
    };
  }

  if (snapshot.state === "missing") {
    return {
      status: "warning",
      message: "No auth.json found for this profile.",
    };
  }

  if (snapshot.state === "parse_error") {
    return {
      status: "error",
      message: `Invalid auth.json: ${truncate(snapshot.message)}`,
    };
  }

  if (snapshot.state === "incomplete") {
    return {
      status: "warning",
      message: truncate(snapshot.message),
    };
  }

  if (snapshot.state === "error") {
    return {
      status: "error",
      message: truncate(snapshot.message),
    };
  }

  return null;
}

function normalizeAccountsList(accounts) {
  const map = new Map();
  for (const entry of accounts) {
    if (!entry || typeof entry !== "object") continue;
    const { name, authFile } = entry;
    if (!name) continue;
    map.set(name, { name, authFile });
  }
  return Array.from(map.values());
}

export function createUsageManager({
  configRoot,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  fetchDelayMs = DEFAULT_FETCH_DELAY_MS,
} = {}) {
  if (!configRoot) {
    throw new Error("configRoot is required to create a UsageManager.");
  }

  ensureDir(configRoot);
  const cacheFile = path.join(configRoot, CACHE_FILE_NAME);
  let cache = loadCache(cacheFile);
  let inFlight = null;
  let pending = null;
  const listeners = new Set();

  function notifyUpdate() {
    for (const listener of listeners) {
      try {
        listener();
      } catch (e) {
        console.warn(`Usage listener threw an error: ${e.message}`);
      }
    }
  }

  function pruneMissingAccounts(accountNames) {
    let mutated = false;
    for (const existing of Object.keys(cache.entries)) {
      if (!accountNames.has(existing)) {
        delete cache.entries[existing];
        mutated = true;
      }
    }
    if (mutated) {
      saveCache(cacheFile, cache);
      notifyUpdate();
    }
  }

  function shouldFetch(name, force) {
    if (force) return true;
    const entry = cache.entries[name];
    if (!entry) return true;
    const age = Date.now() - entry.fetchedAt;
    return age >= cacheTtlMs;
  }

  async function fetchAndStore({ name, authFile }) {
    const snapshot = await fetchUsageSnapshot(authFile);
    const summary = summarizeUsageSnapshot(snapshot);
    cache.entries[name] = {
      summary,
      fetchedAt: Date.now(),
    };
    saveCache(cacheFile, cache);
    notifyUpdate();
  }

  async function refreshImpl(accounts, force) {
    let first = true;
    for (const account of accounts) {
      try {
        if (!shouldFetch(account.name, force)) {
          continue;
        }
        if (!first) {
          await delay(fetchDelayMs);
        }
        first = false;
        await fetchAndStore(account);
      } catch (e) {
        console.warn(
          `Failed to refresh usage for '${account.name}': ${e.message}`
        );
      }
    }
  }

  function enqueueRefresh(accounts, options) {
    const { force = false, pruneMissing = false } = options || {};
    const normalized = normalizeAccountsList(accounts);
    if (pruneMissing) {
      const accountNames = new Set(normalized.map((a) => a.name));
      pruneMissingAccounts(accountNames);
    }
    if (normalized.length === 0) {
      return Promise.resolve();
    }

    const schedule = { accounts: normalized, force, pruneMissing };
    if (inFlight) {
      if (pending) {
        const mergedMap = new Map();
        for (const existing of pending.accounts) {
          mergedMap.set(existing.name, existing);
        }
        for (const incoming of normalized) {
          mergedMap.set(incoming.name, incoming);
        }
        pending = {
          accounts: Array.from(mergedMap.values()),
          force: pending.force || force,
          pruneMissing: pending.pruneMissing || pruneMissing,
        };
      } else {
        pending = schedule;
      }
      return inFlight;
    }

    inFlight = refreshImpl(normalized, force)
      .catch((e) => {
        console.warn(`Usage refresh failed: ${e.message}`);
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
  }

  return {
    getCacheTtlMs() {
      return cacheTtlMs;
    },
    getSummary(name) {
      if (!name) return null;
      const entry = cache.entries[name];
      if (!entry) return null;
      const ageMs = Date.now() - entry.fetchedAt;
      return {
        summary: entry.summary || null,
        fetchedAt: entry.fetchedAt,
        ageMs,
        stale: ageMs >= cacheTtlMs,
      };
    },
    getAllSummaries(accounts = {}) {
      const result = {};
      for (const name of Object.keys(accounts)) {
        result[name] = this.getSummary(name);
      }
      return result;
    },
    refreshAccounts(accounts, { force = false, pruneMissing = false } = {}) {
      return enqueueRefresh(accounts, { force, pruneMissing });
    },
    invalidateCache() {
      cache = { version: CACHE_VERSION, entries: {} };
      saveCache(cacheFile, cache);
      notifyUpdate();
    },
    removeAccount(name) {
      if (cache.entries[name]) {
        delete cache.entries[name];
        saveCache(cacheFile, cache);
        notifyUpdate();
      }
    },
    renameAccount(oldName, newName) {
      if (oldName === newName) return;
      const entry = cache.entries[oldName];
      if (entry) {
        cache.entries[newName] = entry;
        delete cache.entries[oldName];
        saveCache(cacheFile, cache);
        notifyUpdate();
      }
    },
    onUpdate(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
