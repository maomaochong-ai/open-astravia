import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { CONFIG_DIR_NAME, getAgentDir } from "../../config.js";
import type { SettingsScope } from "../contracts/settings-document.js";
import type { SettingsStoragePort } from "../contracts/settings-storage.js";

export class FileSettingsStorage implements SettingsStoragePort {
	private readonly globalSettingsPath: string;
	private readonly projectSettingsPath: string;

	constructor(cwd: string = process.cwd(), agentDir: string = getAgentDir()) {
		this.globalSettingsPath = join(agentDir, "settings.json");
		this.projectSettingsPath = join(cwd, CONFIG_DIR_NAME, "settings.json");
	}

	withLock(scope: SettingsScope, operation: (current: string | undefined) => string | undefined): void {
		const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
		const directory = dirname(path);
		let release: (() => void) | undefined;

		try {
			const fileExists = existsSync(path);
			if (fileExists) release = lockfile.lockSync(path, { realpath: false });
			const current = fileExists ? readFileSync(path, "utf-8") : undefined;
			const next = operation(current);
			if (next === undefined) return;

			if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
			if (!release) release = lockfile.lockSync(path, { realpath: false });
			writeFileSync(path, next, "utf-8");
		} finally {
			release?.();
		}
	}
}
