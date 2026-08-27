import { createHash } from "node:crypto";
import { access, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { BrowserSessionProfile, BrowserSource } from "@vetta/capability-sdk";
import type { BrowserAutomationLogger, BrowserSessionResources } from "./contracts.js";

function namespaceKey(namespace: string): string {
	return createHash("sha256").update(namespace).digest("hex").slice(0, 24);
}

export function browserResourceRef(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export interface BrowserProfileRegistryOptions {
	baseDirectory?: string;
	legacyBrowserPluginProfile?: string;
	logger?: BrowserAutomationLogger;
}

export class BrowserProfileRegistry {
	private readonly baseDirectory: string;
	private readonly legacyBrowserPluginProfile?: string;
	private readonly logger?: BrowserAutomationLogger;
	private legacyMigration?: Promise<void>;

	constructor(options: BrowserProfileRegistryOptions = {}) {
		this.baseDirectory = options.baseDirectory ?? join(getVettaHomePath(), "browser-automation", "namespaces");
		this.legacyBrowserPluginProfile = options.legacyBrowserPluginProfile;
		this.logger = options.logger;
	}

	async prepareSession(input: {
		namespace: string;
		sessionId: string;
		source: BrowserSource;
		profile: BrowserSessionProfile;
		headed: boolean;
	}): Promise<BrowserSessionResources> {
		const namespaceDirectory = join(this.baseDirectory, namespaceKey(input.namespace));
		const sessionDirectory = join(namespaceDirectory, "sessions", input.sessionId);
		const persistentProfile = input.profile.type === "persistent";
		let profilePath: string | undefined;
		if (input.source !== "attach") {
			profilePath =
				input.profile.type === "persistent"
					? join(namespaceDirectory, "profiles", input.profile.id)
					: join(sessionDirectory, "profile");
		}
		const actionPolicyPath = join(sessionDirectory, "action-policy.json");
		const configPath = join(sessionDirectory, "config.json");
		await mkdir(sessionDirectory, { recursive: true });
		if (profilePath) {
			if (input.namespace === "browser" && input.profile.type === "persistent" && input.profile.id === "default") {
				await this.migrateLegacyBrowserProfile(profilePath);
			}
			await mkdir(profilePath, { recursive: true });
		}
		await writeFile(
			actionPolicyPath,
			JSON.stringify({ default: "allow", deny: ["eval", "upload", "download"] }, null, 2),
			"utf8",
		);
		const config: Record<string, unknown> = {
			headed: input.headed,
			contentBoundaries: true,
			maxOutput: 20_000,
			actionPolicy: actionPolicyPath,
			pinTab: true,
		};
		if (input.source === "attach") config.autoConnect = true;
		else config.profile = profilePath;
		await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
		return { configPath, profilePath, sessionDirectory, persistentProfile };
	}

	async releaseSession(resources: BrowserSessionResources): Promise<void> {
		await rm(resources.sessionDirectory, { recursive: true, force: true });
	}

	private async migrateLegacyBrowserProfile(target: string): Promise<void> {
		const source = this.legacyBrowserPluginProfile;
		if (!source) return;
		this.legacyMigration ??= (async () => {
			if ((await pathExists(target)) || !(await pathExists(source))) return;
			await mkdir(dirname(target), { recursive: true });
			await cp(source, target, { recursive: true, errorOnExist: true, force: false });
			this.logger?.info("browser legacy profile migrated", {
				namespace: "browser",
				profileRef: browserResourceRef("default"),
			});
		})().catch((error) => {
			this.logger?.error("browser legacy profile migration failed", {
				namespace: "browser",
				errorKind: error instanceof Error ? error.name : "unknown",
			});
			this.legacyMigration = undefined;
			throw error;
		});
		return this.legacyMigration;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
