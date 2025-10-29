import chalk from "chalk";
import os from "os";
import type { UsageEntry, UsageSummary, UsageSummaryOrMessage } from "./usage.js";

type AuthStatus = "Authenticated" | "Unauthenticated";
type ActiveAuthStatus = AuthStatus | "No profile";
type RateLimitWindow = UsageSummary["rateLimit"]["primary"];
type CreditsSummary = UsageSummary["credits"];

const STRIP_ANSI_REGEX = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string): string => value.replace(STRIP_ANSI_REGEX, "");

const formatDuration = (seconds?: number | null): string | null => {
  if (seconds === undefined || seconds === null) {
    return null;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const units: Array<{ label: string; size: number }> = [
    { label: "d", size: 86400 },
    { label: "h", size: 3600 },
    { label: "m", size: 60 },
    { label: "s", size: 1 },
  ];

  let remaining = Math.round(seconds);
  const parts: string[] = [];
  for (const unit of units) {
    if (remaining >= unit.size) {
      const value = Math.floor(remaining / unit.size);
      parts.push(`${value}${unit.label}`);
      remaining -= value * unit.size;
    }
    if (parts.length === 2) {
      break;
    }
  }

  if (parts.length === 0) {
    return "0s";
  }

  return parts.join(" ");
};

const formatRateWindow = (label: string, windowData: RateLimitWindow): string | null => {
  if (!windowData) {
    return null;
  }
  const segments: string[] = [];
  if (typeof windowData.usedPercent === "number") {
    segments.push(`${windowData.usedPercent}% used`);
  }
  const reset = formatDuration(windowData.resetAfterSeconds);
  if (reset) {
    segments.push(`resets in ${reset}`);
  }
  const span = formatDuration(windowData.limitWindowSeconds);
  if (span) {
    segments.push(`window ${span}`);
  }
  if (segments.length === 0) {
    return null;
  }
  return `${chalk.dim(`  ${label}:`)} ${chalk.white(segments.join(" · "))}`;
};

const formatCredits = (credits: CreditsSummary): string | null => {
  if (!credits) {
    return null;
  }
  const segments: string[] = [];
  if (credits.balance !== null && credits.balance !== undefined) {
    segments.push(`balance ${credits.balance}`);
  }
  if (typeof credits.unlimited === "boolean") {
    segments.push(credits.unlimited ? "unlimited" : "limited");
  }
  if (segments.length === 0) {
    return null;
  }
  return `${chalk.dim("  Credits:")} ${chalk.white(segments.join(" · "))}`;
};

const formatAgeLabel = (entry: UsageEntry & { ageMs: number; stale: boolean }): string | null => {
  const seconds = entry.ageMs / 1000;
  const formatted = formatDuration(seconds);
  return formatted ? `cached ${formatted} ago` : null;
};

const buildUsageLines = (
  entry: (UsageEntry & { ageMs: number; stale: boolean }) | null
): string[] => {
  const summary = entry?.summary ?? null;
  const metaParts: string[] = [];
  if (entry?.stale) {
    metaParts.push(chalk.yellow("stale"));
  }
  const agePart = entry ? formatAgeLabel(entry) : null;
  if (agePart) {
    metaParts.push(chalk.dim(agePart));
  }
  const metaSuffix = metaParts.length > 0 ? ` ${chalk.dim(`(${metaParts.join(", ")})`)}` : "";

  if (!summary) {
    return metaParts.length > 0
      ? [`${chalk.cyan.bold("Usage:")} ${chalk.dim("No data")}${metaSuffix}`]
      : [];
  }

  if (summary.status !== "ok") {
    const label =
      summary.status === "error" ? chalk.red("Usage:") : chalk.yellow("Usage:");
    const fallback =
      summary.status === "error" ? "Unable to retrieve usage." : "Usage unavailable.";
    return [`${label} ${chalk.dim(summary.message || fallback)}${metaSuffix}`];
  }

  const okSummary: UsageSummary = summary;
  const separator = chalk.dim(" · ");
  const summaryParts: string[] = [];
  if (okSummary.planType) {
    summaryParts.push(`plan ${chalk.white(okSummary.planType)}`);
  }
  if (okSummary.rateLimit.limitReached === true) {
    summaryParts.push(chalk.red("limit reached"));
  } else if (okSummary.rateLimit.allowed === false) {
    summaryParts.push(chalk.yellow("requests blocked"));
  }
  if (entry?.stale) {
    summaryParts.push(chalk.yellow("stale"));
  }
  if (agePart) {
    summaryParts.push(chalk.dim(agePart));
  }
  if (summaryParts.length === 0) {
    summaryParts.push(chalk.white("active"));
  }

  const lines: string[] = [
    `${chalk.cyan.bold("Usage:")} ${summaryParts.join(separator)}`,
  ];

  const primaryLine = formatRateWindow("Primary", okSummary.rateLimit.primary);
  if (primaryLine) {
    lines.push(primaryLine);
  }

  const secondaryLine = formatRateWindow("Secondary", okSummary.rateLimit.secondary);
  if (secondaryLine) {
    lines.push(secondaryLine);
  }

  const creditsLine = formatCredits(okSummary.credits);
  if (creditsLine) {
    lines.push(creditsLine);
  }

  return lines;
};

const padEnd = (value: string, width: number): string => {
  const visibleLength = stripAnsi(value).length;
  if (visibleLength >= width) {
    return value;
  }
  return value + " ".repeat(width - visibleLength);
};

const formatStatus = (status: AuthStatus): string => {
  if (status === "Authenticated") {
    return chalk.black.bgGreen(` ${status} `);
  }
  return chalk.black.bgYellow(` ${status} `);
};

const toTildePath = (fullPath: string): string => {
  const home = os.homedir();
  return fullPath.startsWith(home) ? `~${fullPath.slice(home.length)}` : fullPath;
};

const drawSectionTitle = (label: string, width: number): string => {
  const title = ` ${label.toUpperCase()} `;
  const lineWidth = Math.max(width - stripAnsi(title).length - 1, 0);
  return chalk.gray(title + "─".repeat(lineWidth));
};

export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[0;0H");
}

export function renderExecutionBanner(
  name: string,
  status: AuthStatus,
  codexHomePath: string,
  usageEntry: (UsageEntry & { ageMs: number; stale: boolean }) | null
): void {
  const padding = "  ";
  const title = chalk.white.bold("CODEX ACCOUNT MANAGER");
  const nameLine = `${chalk.cyan.bold("Profile:")}${padding}${chalk.white(name)}`;
  const statusText =
    status === "Authenticated" ? chalk.bgGreen.black(` ${status} `) : chalk.bgYellow.black(` ${status} `);
  const statusLine = `${chalk.cyan.bold("Status:")}${padding}${statusText}`;
  const pathLine = `${chalk.dim("Path:")}${padding}${chalk.dim(codexHomePath)}`;

  const usageLines = buildUsageLines(usageEntry);
  const bodyLines = [nameLine, statusLine, pathLine, ...usageLines];

  const visibleLengths = [title, ...bodyLines].map((line) => stripAnsi(line).length);
  const maxVisible = Math.max(...visibleLengths, 0);
  const minWidth = 50;
  const boxWidth = Math.max(minWidth, maxVisible + 6);
  const border = chalk.magenta("─".repeat(boxWidth - 2));

  console.error(chalk.magenta.bold(`\n┌${border}┐`));
  const titlePadding = Math.max(0, boxWidth - stripAnsi(title).length - 3);
  console.error(chalk.magenta.bold(`│ ${title}${" ".repeat(titlePadding)} │`));
  console.error(chalk.magenta.bold(`├${border}┤`));

  for (const line of bodyLines) {
    const padCount = Math.max(0, boxWidth - stripAnsi(line).length - 3);
    console.error(chalk.magenta.bold(`│ ${line}${" ".repeat(padCount)} │`));
  }

  console.error(chalk.magenta.bold(`└${border}┘`));
}

export function renderDashboard(params: {
  config: {
    active: string | null;
    accounts: Record<string, { authFile: string }>;
  };
  activeStatus: ActiveAuthStatus;
  statusByAccount: Record<string, "Authenticated" | "Unauthenticated">;
  usageByAccount: Record<string, (UsageEntry & { ageMs: number; stale: boolean }) | null>;
  lastAction?: string | null;
}): void {
  const { config, activeStatus, statusByAccount, usageByAccount, lastAction } = params;
  const width = Math.min(Math.max(process.stdout.columns ?? 80, 70), 110);
  const headerWidth = width - 2;
  const bannerLabel = chalk.white.bold(" Codex Switcher ");
  const bannerPad = Math.max(0, headerWidth - stripAnsi(bannerLabel).length);

  clearScreen();
  console.log(chalk.bgMagenta.black(`┏${"━".repeat(headerWidth)}┓`));
  console.log(chalk.bgMagenta.black(`┃${bannerLabel}${" ".repeat(bannerPad)}┃`));
  console.log(chalk.bgMagenta.black(`┗${"━".repeat(headerWidth)}┛`));

  const activeName = config.active;
  const activeAccount = activeName ? config.accounts[activeName] : null;
  const activeUsage = activeName ? usageByAccount[activeName] ?? null : null;

  console.log(drawSectionTitle("Active Profile", width));
  if (activeName && activeAccount) {
    const shownStatus: AuthStatus =
      activeStatus === "No profile" ? "Unauthenticated" : activeStatus;
    console.log(
      `${chalk.green("➤")} ${chalk.cyan.bold(activeName)}  ${formatStatus(shownStatus)}`
    );
    console.log(`   ${chalk.dim(`Auth → ${toTildePath(activeAccount.authFile)}`)}`);
    for (const line of buildUsageLines(activeUsage)) {
      console.log(`   ${line}`);
    }
  } else {
    console.log(chalk.yellow("No active profile. Use 'Use profile' to select."));
  }

  if (lastAction) {
    console.log("");
    console.log(`${chalk.dim("Last action:")} ${lastAction.trim()}`);
  }

  console.log("");
  console.log(drawSectionTitle("Profiles", width));

  const accountNames = Object.keys(config.accounts).sort((a, b) => a.localeCompare(b));
  if (accountNames.length === 0) {
    console.log(chalk.yellow("No profiles configured. Choose 'Add profile' to get started."));
  } else {
    const rows = accountNames.map((name, idx) => {
      const status: AuthStatus =
        name === activeName
          ? activeStatus === "No profile"
            ? "Unauthenticated"
            : (activeStatus as AuthStatus)
          : statusByAccount[name];
      return {
        index: idx + 1,
        name,
        authFile: config.accounts[name].authFile,
        status,
        isActive: name === activeName,
      };
    });

    const indexWidth = String(rows.length).length + 2;
    const nameWidth = Math.max(...rows.map((row) => stripAnsi(row.name).length), 8);
    const statusWidth = Math.max(
      ...rows.map((row) => stripAnsi(formatStatus(row.status)).length),
      13
    );

    const header =
      padEnd(chalk.dim("#"), indexWidth) +
      " " +
      padEnd(chalk.dim("Profile"), nameWidth + 4) +
      padEnd(chalk.dim("Status"), statusWidth + 2) +
      chalk.dim("Auth File");
    console.log(header);
    console.log(chalk.gray("-".repeat(width - 4)));

    for (const row of rows) {
      const marker = row.isActive ? chalk.green("★") : " ";
      const indexCell = padEnd(`${marker} ${row.index}`, indexWidth);
      const nameCell = padEnd(
        row.isActive ? chalk.white.bold(row.name) : chalk.white(row.name),
        nameWidth + 4
      );
      const statusCell = padEnd(formatStatus(row.status), statusWidth + 2);
      console.log(`${indexCell} ${nameCell}${statusCell}${chalk.dim(toTildePath(row.authFile))}`);

      if (!row.isActive) {
        const usageLines = buildUsageLines(usageByAccount[row.name] ?? null);
        for (const line of usageLines) {
          console.log(`   ${chalk.dim(line)}`);
        }
      }
    }
  }

  console.log("");
  console.log(drawSectionTitle("Shortcuts", width));
  console.log(`${chalk.dim("↵")} Confirm  ${chalk.dim("↑/↓")} Navigate  ${chalk.dim("Esc")} Cancel`);
  console.log(chalk.dim("Press Ctrl+C at any time to quit or use the menu to exit."));
}
