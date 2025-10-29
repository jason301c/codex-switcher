import chalk from "chalk";
import os from "os";

const STRIP_ANSI_REGEX = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s) => s.replace(STRIP_ANSI_REGEX, "");

function formatDuration(seconds) {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return null;
  }
  let remaining = Math.round(seconds);
  const units = [
    { label: "d", size: 86400 },
    { label: "h", size: 3600 },
    { label: "m", size: 60 },
    { label: "s", size: 1 },
  ];
  const parts = [];
  for (const unit of units) {
    if (remaining >= unit.size) {
      const value = Math.floor(remaining / unit.size);
      parts.push(`${value}${unit.label}`);
      remaining -= value * unit.size;
    }
    if (parts.length === 2) break;
  }
  if (parts.length === 0) {
    return "0s";
  }
  return parts.join(" ");
}

function formatRateWindow(label, windowData) {
  if (!windowData) return null;
  const segments = [];
  if (typeof windowData.usedPercent === "number") {
    segments.push(`${windowData.usedPercent}% used`);
  }
  if (typeof windowData.resetAfterSeconds === "number") {
    const reset = formatDuration(windowData.resetAfterSeconds);
    if (reset) {
      segments.push(`resets in ${reset}`);
    }
  }
  if (typeof windowData.limitWindowSeconds === "number") {
    const span = formatDuration(windowData.limitWindowSeconds);
    if (span) {
      segments.push(`window ${span}`);
    }
  }
  if (segments.length === 0) return null;
  return `${chalk.dim(`  ${label}:`)} ${chalk.white(segments.join(" · "))}`;
}

function formatCredits(credits) {
  if (!credits) return null;
  const segments = [];
  if (credits.balance != null) {
    segments.push(`balance ${credits.balance}`);
  }
  if (typeof credits.unlimited === "boolean") {
    segments.push(credits.unlimited ? "unlimited" : "limited");
  }
  if (segments.length === 0) return null;
  return `${chalk.dim("  Credits:")} ${chalk.white(segments.join(" · "))}`;
}

function buildUsageLines(usage, meta = {}) {
  const ageLabel =
    typeof meta.ageMs === "number" && meta.ageMs >= 0
      ? formatDuration(meta.ageMs / 1000)
      : null;
  const metaParts = [];
  if (meta.stale) {
    metaParts.push(chalk.yellow("stale"));
  }
  if (ageLabel) {
    metaParts.push(chalk.dim(`cached ${ageLabel} ago`));
  }
  const metaSuffix =
    metaParts.length > 0 ? ` ${chalk.dim(`(${metaParts.join(", ")})`)}` : "";

  if (!usage) {
    return metaParts.length
      ? [`${chalk.cyan.bold("Usage:")} ${chalk.dim("No data")}${metaSuffix}`]
      : [];
  }
  if (usage.status === "error") {
    return [
      `${chalk.red("Usage:")} ${chalk.dim(
        usage.message || "Unable to retrieve usage."
      )}${metaSuffix}`,
    ];
  }
  if (usage.status === "warning") {
    return [
      `${chalk.yellow("Usage:")} ${chalk.dim(
        usage.message || "Usage unavailable."
      )}${metaSuffix}`,
    ];
  }
  if (usage.status !== "ok") {
    return [];
  }

  const separator = chalk.dim(" · ");
  const summaryParts = [];
  if (usage.planType) {
    summaryParts.push(`plan ${chalk.white(usage.planType)}`);
  }
  if (usage.rateLimit?.limitReached === true) {
    summaryParts.push(chalk.red("limit reached"));
  } else if (usage.rateLimit?.allowed === false) {
    summaryParts.push(chalk.yellow("requests blocked"));
  }
  if (meta.stale) {
    summaryParts.push(chalk.yellow("stale"));
  }
  if (ageLabel) {
    summaryParts.push(chalk.dim(`cached ${ageLabel} ago`));
  }
  if (summaryParts.length === 0) {
    summaryParts.push(chalk.white("active"));
  }

  const lines = [
    `${chalk.cyan.bold("Usage:")} ${summaryParts.join(separator)}`,
  ];

  const primaryLine = formatRateWindow("Primary", usage.rateLimit?.primary);
  if (primaryLine) lines.push(primaryLine);

  const secondaryLine = formatRateWindow("Secondary", usage.rateLimit?.secondary);
  if (secondaryLine) lines.push(secondaryLine);

  const creditLine = formatCredits(usage.credits);
  if (creditLine) lines.push(creditLine);

  return lines;
}

/**
 * Renders a highly stylized banner for the active CODEX account during execution.
 * @param {string} name - The name of the active profile.
 * @param {string} status - The authentication status (e.g., "Authenticated").
 * @param {string} codexHomePath - The actual CODEX_HOME path.
 */
export function renderExecutionBanner(
  name,
  status,
  codexHomePath,
  usageEntry
) {
  const padding = " ".repeat(2);

  // Prepare raw content strings (these include chalk styling)
  const title = chalk.white.bold("CODEX ACCOUNT MANAGER");
  const nameLine = `${chalk.cyan.bold("Profile:")}${padding}${chalk.white(
    name
  )}`;
  const statusText = status.includes("Authenticated")
    ? chalk.bgGreen.black(` ${status} `)
    : chalk.bgYellow.black(` ${status} `);
  const statusLine = `${chalk.cyan.bold("Status:")}${padding}${statusText}`;
  const pathLabel = `${chalk.dim("Path:")}${padding}${chalk.dim(
    codexHomePath
  )}`;

  const usageLines = buildUsageLines(
    usageEntry ? usageEntry.summary : null,
    usageEntry || {}
  );
  const bodyLines = [nameLine, statusLine, pathLabel, ...usageLines];

  // Compute visible lengths (without ANSI codes) and derive a fitted box width
  const visibleLengths = [title, ...bodyLines].map((s) => stripAnsi(s).length);
  const maxVisible = Math.max(...visibleLengths, 0);

  const minWidth = 50;
  // boxWidth is the total width including the two border chars, ensure it's at
  // least minWidth and large enough to contain the longest visible content + padding
  const boxWidth = Math.max(minWidth, maxVisible + 6);
  const border = chalk.magenta("─".repeat(boxWidth - 2));

  console.error(chalk.magenta.bold("\n┌" + border + "┐"));
  // Title line
  {
    const visible = stripAnsi(title).length;
    const padCount = Math.max(0, boxWidth - visible - 3);
    console.error(chalk.magenta.bold(`│ ${title}${" ".repeat(padCount)} │`));
  }

  console.error(chalk.magenta.bold("├" + border + "┤"));

  bodyLines.forEach((line) => {
    const visible = stripAnsi(line).length;
    const padCount = Math.max(0, boxWidth - visible - 3);
    console.error(
      chalk.magenta.bold(`│ ${line}${" ".repeat(padCount)} │`)
    );
  });

  console.error(chalk.magenta.bold("└" + border + "┘"));
}

function padEnd(input, width) {
  const visibleLen = stripAnsi(input).length;
  if (visibleLen >= width) {
    return input;
  }
  return input + " ".repeat(width - visibleLen);
}

function formatStatus(status) {
  if (status.includes("Authenticated")) {
    return chalk.black.bgGreen(` ${status} `);
  }
  return chalk.black.bgYellow(` ${status} `);
}

function toTildePath(fullPath) {
  const home = os.homedir();
  if (fullPath.startsWith(home)) {
    return `~${fullPath.slice(home.length)}`;
  }
  return fullPath;
}

function drawSectionTitle(label, width) {
  const title = ` ${label.toUpperCase()} `;
  const lineWidth = Math.max(width - stripAnsi(title).length - 1, 0);
  return chalk.gray(title + "─".repeat(lineWidth));
}

export function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[0;0H");
}

export function renderDashboard(
  config,
  getAuthStatus,
  { lastAction, usageByAccount } = {}
) {
  const width = Math.min(Math.max(process.stdout.columns || 80, 70), 110);
  const headerWidth = width - 2;
  const bannerLabel = chalk.white.bold(" Codex Switcher ");
  const bannerPad = Math.max(0, headerWidth - stripAnsi(bannerLabel).length);

  clearScreen();

  console.log(
    chalk.bgMagenta.black("┏" + "━".repeat(headerWidth) + "┓")
  );
  console.log(
    chalk.bgMagenta.black(
      "┃" + bannerLabel + " ".repeat(bannerPad) + "┃"
    )
  );
  console.log(
    chalk.bgMagenta.black("┗" + "━".repeat(headerWidth) + "┛")
  );

  const activeName = config.active;
  const activeAccount = activeName ? config.accounts[activeName] : null;
  const activeStatus =
    activeName && activeAccount
      ? getAuthStatus(activeAccount.authFile)
      : "No profile";
  const activeUsage = usageByAccount ? usageByAccount[activeName] : null;

  console.log(drawSectionTitle("Active Profile", width));

  if (activeName && activeAccount) {
    console.log(
      `${chalk.green("➤")} ${chalk.cyan.bold(activeName)}  ${formatStatus(
        activeStatus
      )}`
    );
    console.log(`   ${chalk.dim(`Auth → ${toTildePath(activeAccount.authFile)}`)}`);
    const usageLines = buildUsageLines(
      activeUsage ? activeUsage.summary : null,
      activeUsage || {}
    );
    usageLines.forEach((line) => {
      console.log(`   ${line}`);
    });
  } else {
    console.log(chalk.yellow("No active profile. Use 'Use profile' to select."));
  }

  if (lastAction) {
    console.log("");
    const formatted =
      typeof lastAction === "string" ? lastAction.trim() : lastAction;
    console.log(`${chalk.dim("Last action:")} ${formatted}`);
  }

  console.log("");
  console.log(drawSectionTitle("Profiles", width));

  const accountNames = Object.keys(config.accounts).sort((a, b) =>
    a.localeCompare(b)
  );

  if (accountNames.length === 0) {
    console.log(
      chalk.yellow(
        "No profiles configured. Choose 'Add profile' to get started."
      )
    );
  } else {
    const rows = accountNames.map((name, idx) => {
      const account = config.accounts[name];
      const status = getAuthStatus(account.authFile);
      return {
        index: idx + 1,
        name,
        status,
        path: toTildePath(account.authFile),
        isActive: name === activeName,
      };
    });

    const indexWidth = String(rows.length).length + 2;
    const nameWidth = Math.max(
      ...rows.map((row) => stripAnsi(row.name).length),
      8
    );
    const statusWidth = Math.max(
      ...rows.map((row) => stripAnsi(formatStatus(row.status)).length),
      13
    );

    const baseHeader =
      padEnd(chalk.dim("#"), indexWidth) +
      " " +
      padEnd(chalk.dim("Profile"), nameWidth + 4) +
      padEnd(chalk.dim("Status"), statusWidth + 2) +
      chalk.dim("Auth File");

    console.log(baseHeader);
    console.log(chalk.gray("-".repeat(width - 4)));

      rows.forEach((row) => {
        const marker = row.isActive ? chalk.green("★") : " ";
        const indexCell = padEnd(`${marker} ${row.index}`, indexWidth);
        const nameCell = padEnd(
          row.isActive ? chalk.white.bold(row.name) : chalk.white(row.name),
          nameWidth + 4
        );
        const statusCell = padEnd(formatStatus(row.status), statusWidth + 2);
        console.log(
          `${indexCell} ${nameCell}${statusCell}${chalk.dim(row.path)}`
        );
        if (!row.isActive && usageByAccount) {
          const usageEntry = usageByAccount[row.name];
          const usageLines = buildUsageLines(
            usageEntry ? usageEntry.summary : null,
            usageEntry || {}
          );
          usageLines.forEach((line) => {
            console.log(`   ${chalk.dim(line)}`);
          });
        }
      });
  }

  console.log("");
  console.log(drawSectionTitle("Shortcuts", width));
  console.log(
    `${chalk.dim("↵")} Confirm  ${chalk.dim("↑/↓")} Navigate  ${chalk.dim("Esc")} Cancel`
  );
  console.log(
    chalk.dim("Press Ctrl+C at any time to quit or use the menu to exit.")
  );
}
