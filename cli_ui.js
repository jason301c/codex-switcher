import chalk from "chalk";
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

/**
 * Renders the list of configured accounts with clear indicators.
 * @param {object} config - The accounts configuration object.
 * @param {function} getAuthStatus - Function to get the colorized auth status.
 */
export function renderAccountList(config, getAuthStatus) {
  const names = Object.keys(config.accounts).sort();

  console.log(`\n${chalk.white.bold.bgBlue(" CODEX ACCOUNT PROFILES ")}`);
  console.log(chalk.blue("────────────────────────"));

  if (names.length === 0) {
    console.log(
      chalk.yellow("No accounts configured. Use ") +
        chalk.cyan.bold("ccx add <name>") +
        chalk.yellow(" to begin.")
    );
    return;
  }

  names.forEach((name) => {
    const isActive = name === config.active;
    const accountPath = config.accounts[name];
    const authStatus = getAuthStatus(accountPath);

    // Indicator for active profile
    const marker = isActive ? chalk.green.bold("➤ ") : chalk.gray("  ");

    // Profile Name and Status
    const statusIcon = authStatus.includes("Authenticated")
      ? chalk.green("✔")
      : chalk.yellow("⚠");

    console.log(
      `${marker}${statusIcon} ${chalk.cyan.bold(name)} ${chalk.white(
        `[${authStatus}]`
      )}`
    );

    // Detailed path underneath
    console.log(
      `    ${chalk.dim("Path:")} ${chalk.dim(path.basename(accountPath))}/`
    );

    // Separator unless last item
    if (names.indexOf(name) < names.length - 1) {
      console.log(chalk.gray("    —"));
    }
  });

  if (!config.active) {
    console.log(
      chalk.red('\nNo profile is currently active. Use "ccx use <name>".')
    );
  } else if (config.active && !config.accounts[config.active]) {
    console.log(
      chalk.red("\nError: Active profile directory appears missing.")
    );
  }
}
