import chalk from "chalk";
import os from "os";
import path from "path";

/**
 * Renders a highly stylized banner for the active CODEX account during execution.
 * @param {string} name - The name of the active profile.
 * @param {string} status - The authentication status (e.g., "Authenticated").
 * @param {string} codexHomePath - The actual CODEX_HOME path.
 */
export function renderExecutionBanner(name, status, codexHomePath) {
  // Helper to strip ANSI escape sequences so visible length can be measured
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

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

  // Compute visible lengths (without ANSI codes) and derive a fitted box width
  const visibleLengths = [title, nameLine, statusLine, pathLabel].map(
    (s) => stripAnsi(s).length
  );
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

  // Name line
  {
    const visible = stripAnsi(nameLine).length;
    const padCount = Math.max(0, boxWidth - visible - 3);
    console.error(chalk.magenta.bold(`│ ${nameLine}${" ".repeat(padCount)} │`));
  }

  // Status line
  {
    const visible = stripAnsi(statusLine).length;
    const padCount = Math.max(0, boxWidth - visible - 3);
    console.error(
      chalk.magenta.bold(`│ ${statusLine}${" ".repeat(padCount)} │`)
    );
  }

  // Path line
  {
    const visible = stripAnsi(pathLabel).length;
    const padCount = Math.max(0, boxWidth - visible - 3);
    console.error(
      chalk.magenta.bold(`│ ${pathLabel}${" ".repeat(padCount)} │`)
    );
  }

  console.error(chalk.magenta.bold("└" + border + "┘"));
}

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

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

export function renderDashboard(config, getAuthStatus, { lastAction } = {}) {
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
  const activePath = activeName ? config.accounts[activeName] : null;
  const activeStatus =
    activeName && activePath ? getAuthStatus(activePath) : "No profile";

  console.log(drawSectionTitle("Active Profile", width));

  if (activeName && activePath) {
    console.log(
      `${chalk.green("➤")} ${chalk.cyan.bold(activeName)}  ${formatStatus(
        activeStatus
      )}`
    );
    console.log(`   ${chalk.dim(toTildePath(activePath))}`);
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
      const accountPath = config.accounts[name];
      const status = getAuthStatus(accountPath);
      return {
        index: idx + 1,
        name,
        status,
        path: toTildePath(accountPath),
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
      padEnd(chalk.dim("Profile"), nameWidth + 4) +
      padEnd(chalk.dim("Status"), statusWidth + 2) +
      chalk.dim("Location");

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
      console.log(`${indexCell}${nameCell}${statusCell}${chalk.dim(row.path)}`);
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
