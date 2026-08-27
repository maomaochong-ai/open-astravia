import type {
	PluginBrowserAction,
	PluginBrowserApi,
	PluginBrowserSession,
} from "@vetta-org/plugin-sdk";
import {
	type BrowserPluginSettings,
	normalizeBrowserSettings,
	parseAllowedHosts,
} from "../config/settings";

const DEFAULT_PROFILE_ID = "default";
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type BrowserToolInput =
	| { operation: "status" }
	| { operation: "navigate"; profileId?: string; url: string }
	| { operation: "snapshot"; profileId?: string; interactiveOnly?: boolean }
	| { operation: "read_text"; profileId?: string; maxChars?: number }
	| {
			operation: "act";
			profileId?: string;
			action: PluginBrowserAction;
			snapshotRevision?: number;
	  }
	| { operation: "close"; profileId?: string };

interface ManagedSession {
	session: PluginBrowserSession;
	signature: string;
}

function profileId(input: BrowserToolInput): string {
	const value = "profileId" in input ? (input.profileId ?? DEFAULT_PROFILE_ID).trim() : DEFAULT_PROFILE_ID;
	if (!PROFILE_ID_PATTERN.test(value)) {
		throw new Error("profileId must use letters, numbers, dot, underscore, colon or hyphen (max 128 characters)");
	}
	return value;
}

function sessionSignature(settings: BrowserPluginSettings, allowedHosts: readonly string[]): string {
	return JSON.stringify({
		source: settings.browserSource,
		headed: settings.headed,
		allowedHosts: [...allowedHosts].sort(),
	});
}

function truncate(value: string | undefined, maxChars: number): { value?: string; truncated: boolean } {
	if (value === undefined) return { truncated: false };
	return { value: value.slice(0, maxChars), truncated: value.length > maxChars };
}

/**
 * 将 Agent 的“账号 profile”映射为宿主 session，并串行化同一 profile 的操作。
 * 持久化、目录和登录态生命周期仍由宿主负责；这里仅持有不透明 session id。
 */
export class BrowserSessionBroker {
	private readonly sessions = new Map<string, ManagedSession>();
	private readonly queues = new Map<string, Promise<void>>();

	constructor(private readonly browser: PluginBrowserApi) {}

	async execute(input: BrowserToolInput, rawSettings: Readonly<Record<string, unknown>>): Promise<unknown> {
		if (input.operation === "status") return this.browser.runtime.status();
		const id = profileId(input);
		return this.runExclusive(id, async () => {
			if (input.operation === "close") {
				return { closed: await this.closeProfile(id), profileId: id };
			}
			const settings = normalizeBrowserSettings(rawSettings);
			const allowedHosts = parseAllowedHosts(settings.allowedDomains);
			const session = await this.ensureSession(id, settings, allowedHosts);
			switch (input.operation) {
				case "navigate":
					return this.browser.navigate(session.id, input.url);
				case "snapshot": {
					const result = await this.browser.snapshot(session.id, { interactiveOnly: input.interactiveOnly });
					const content = truncate(result.content, settings.maxOutput);
					return { ...result, content: content.value ?? "", truncated: content.truncated, profileId: id };
				}
				case "read_text":
					return this.browser.readText(session.id, {
						maxChars: Math.min(input.maxChars ?? settings.maxOutput, settings.maxOutput),
					});
				case "act": {
					const result = await this.browser.act(session.id, input.action, {
						snapshotRevision: input.snapshotRevision,
					});
					const output = truncate(result.output, settings.maxOutput);
					return { ...result, output: output.value, outputTruncated: output.truncated, profileId: id };
				}
			}
		});
	}

	async closeAll(): Promise<void> {
		for (const id of [...this.sessions.keys()]) {
			await this.runExclusive(id, () => this.closeProfile(id)).catch(() => undefined);
		}
	}

	private async ensureSession(
		id: string,
		settings: BrowserPluginSettings,
		allowedHosts: string[],
	): Promise<PluginBrowserSession> {
		const signature = sessionSignature(settings, allowedHosts);
		const existing = this.sessions.get(id);
		if (existing?.signature === signature) {
			try {
				return await this.browser.sessions.get(existing.session.id);
			} catch {
				this.sessions.delete(id);
			}
		} else if (existing) {
			await this.browser.sessions.close(existing.session.id).catch(() => undefined);
			this.sessions.delete(id);
		}
		const session = await this.browser.sessions.create({
			source: settings.browserSource,
			headed: settings.headed,
			profile: settings.browserSource === "managed" ? { type: "persistent", id } : { type: "ephemeral" },
			allowedHosts,
		});
		this.sessions.set(id, { session, signature });
		return session;
	}

	private async closeProfile(id: string): Promise<boolean> {
		const existing = this.sessions.get(id);
		if (!existing) return false;
		this.sessions.delete(id);
		await this.browser.sessions.close(existing.session.id);
		return true;
	}

	private async runExclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(id) ?? Promise.resolve();
		let release: (() => void) | undefined;
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(() => current);
		this.queues.set(id, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release?.();
			if (this.queues.get(id) === tail) this.queues.delete(id);
		}
	}
}
