# Codex Switcher

Codex Switcher wraps the official `codex` CLI so you can hop between multiple authenticated contexts without touching your real config files. It keeps a dedicated copy of each profile's `auth.json` under `~/.codex_accounts/<profile>.auth.json` and uses a small TUI to keep track of what's active before delegating every command to the real Codex binary.

## Features

- Zero-config TUI (`ccx`) for adding, renaming, deleting, and activating Codex profiles.
- Runs the upstream `codex` command with `CODEX_HOME` automatically set to the active profile.
- Friendly status banners that show which account is live and whether it is authenticated.
- Safe defaults: stores its own state in `~/.codex_switcher/accounts.json`, swaps `auth.json` snapshots in and out of `~/.codex_switcher/shared_codex_home`, and never touches the original Codex files.

## Installation

1. Ensure Node.js 18+ and the official `codex` CLI are on your PATH.
2. Install from npm (preferred):
   ```bash
   npm install -g codex-switcher
   ```
   or clone the repo and `npm install && npm link` if you want to hack on it locally.
3. Run `ccx` to launch the switcher.

## Usage

- `ccx` with no arguments launches the interactive dashboard. Add a profile, activate it, and optionally rename/delete as needed.
- `ccx <anything>` forwards the arguments straight to the real `codex` binary while keeping the currently active profile's `CODEX_HOME`.
- All profile data lives in `~/.codex_accounts` as individual `auth.json` snapshots. Remove a profile in the UI and its saved auth file is deleted for you. The switcher's own metadata sits in `~/.codex_switcher/accounts.json`.

## Development

- Install dependencies with `npm install`, then run `node index.js` for the TUI (or `./index.js` thanks to the shebang).
- The codebase is small (two files) and uses `inquirer` for prompts plus `chalk` for styling. No build step is required.
- There are no automated tests yet—please describe how you verified changes in your PR.

## Contributing

We welcome issues, feature ideas, and pull requests. If you're unsure where to start:

1. Open a GitHub issue describing the problem or idea.
2. Fork the repo, create a feature branch, and keep the CLI behavior ergonomic (short prompts, clear messaging).
3. Add small notes in the PR about manual testing and any new environment variables or files created.

## License

Released under the [Creative Commons Attribution-NonCommercial 4.0 International](./LICENSE) license. You may adapt and share the project as long as you credit `jason301c` and do not use it for commercial purposes.
