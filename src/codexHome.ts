import fs from "fs";
import path from "path";
import { ACTIVE_AUTH_FILE } from "./paths.js";

export function hydrateActiveAuth(authFilePath: string): void {
  try {
    // Ensure the target directory exists before attempting to copy the file.
    const dir = path.dirname(ACTIVE_AUTH_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(authFilePath)) {
      fs.copyFileSync(authFilePath, ACTIVE_AUTH_FILE);
    } else if (fs.existsSync(ACTIVE_AUTH_FILE)) {
      fs.rmSync(ACTIVE_AUTH_FILE, { force: true });
    }
  } catch (error) {
    const err = error as Error;
    throw new Error(
      `Failed to prepare auth file for execution: ${err.message}`
    );
  }
}

export function persistActiveAuth(authFilePath: string): void {
  try {
    const dir = path.dirname(ACTIVE_AUTH_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(ACTIVE_AUTH_FILE)) {
      fs.copyFileSync(ACTIVE_AUTH_FILE, authFilePath);
    } else if (fs.existsSync(authFilePath)) {
      fs.rmSync(authFilePath, { force: true });
    }
  } catch (error) {
    const err = error as Error;
    throw new Error(
      `Failed to persist auth file after execution: ${err.message}`
    );
  }
}
