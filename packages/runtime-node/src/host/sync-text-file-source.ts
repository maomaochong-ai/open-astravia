import { existsSync, readFileSync } from "node:fs";

/** Structural adapter for product domains that synchronously reload optional text configuration. */
export const nodeSyncTextFileSource = Object.freeze({
	exists: existsSync,
	read: (path: string) => readFileSync(path, "utf8"),
});
