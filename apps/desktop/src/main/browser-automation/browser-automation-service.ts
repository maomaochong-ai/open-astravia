import { randomUUID } from "node:crypto";
import type {
	BrowserActInput,
	BrowserActionResult,
	BrowserNavigateInput,
	BrowserPageState,
	BrowserReadTextInput,
	BrowserRuntimeInstallInput,
	BrowserRuntimeStatus,
	BrowserScreenshot,
	BrowserScreenshotInput,
	BrowserSession,
	BrowserSessionCreateInput,
	BrowserSessionInput,
	BrowserSnapshot,
	BrowserSnapshotInput,
	BrowserTextContent,
} from "@vetta/capability-sdk";
import { assertAllowedBrowserUrl, assertReturnedPageAllowed } from "./browser-policy.js";
import { browserResourceRef } from "./browser-profile-registry.js";
import { BrowserSessionRegistry } from "./browser-session-registry.js";
import type {
	BrowserAutomationLogger,
	BrowserEngine,
	BrowserEngineSession,
	BrowserProfilePort,
	BrowserRuntimePort,
	BrowserSessionRecord,
} from "./contracts.js";
import { BrowserAutomationError } from "./contracts.js";

function engineSession(record: BrowserSessionRecord): BrowserEngineSession {
	return {
		id: record.session.id,
		source: record.session.source,
		profile: record.session.profile,
		headed: record.session.headed,
		configPath: record.resources.configPath,
	};
}

function errorCode(error: unknown): string {
	return error instanceof BrowserAutomationError ? error.code : error instanceof Error ? error.name : "unknown";
}

function sameHosts(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((host) => right.includes(host));
}

export interface BrowserAutomationServiceOptions {
	engine: BrowserEngine;
	runtime: BrowserRuntimePort;
	profiles: BrowserProfilePort;
	sessions?: BrowserSessionRegistry;
	logger: BrowserAutomationLogger;
}

export class BrowserAutomationService {
	private readonly engine: BrowserEngine;
	private readonly runtime: BrowserRuntimePort;
	private readonly profiles: BrowserProfilePort;
	private readonly sessions: BrowserSessionRegistry;
	private readonly logger: BrowserAutomationLogger;

	constructor(options: BrowserAutomationServiceOptions) {
		this.engine = options.engine;
		this.runtime = options.runtime;
		this.profiles = options.profiles;
		this.sessions = options.sessions ?? new BrowserSessionRegistry();
		this.logger = options.logger;
	}

	runtimeStatus(signal?: AbortSignal): Promise<BrowserRuntimeStatus> {
		return this.runtime.status(signal);
	}

	installRuntime(input: BrowserRuntimeInstallInput, signal?: AbortSignal): Promise<BrowserRuntimeStatus> {
		return this.runtime.install(input, signal);
	}

	async createSession(input: BrowserSessionCreateInput, signal?: AbortSignal): Promise<BrowserSession> {
		signal?.throwIfAborted();
		const runtime = await this.runtime.status(signal);
		if (runtime.phase !== "ready") {
			throw new BrowserAutomationError("runtime_not_ready", `Browser runtime is ${runtime.phase}`);
		}
		const source = input.source ?? "managed";
		const profile = input.profile ?? { type: "ephemeral" as const };
		if (source === "attach" && profile.type === "persistent") {
			throw new BrowserAutomationError(
				"invalid_request",
				"Attached browser sessions cannot select a managed profile",
			);
		}
		const create = () => this.createSessionRecord(input, source, profile, signal);
		return profile.type === "persistent"
			? this.sessions.runPersistentProfileExclusive(input.namespace, profile.id, create)
			: create();
	}

	private async createSessionRecord(
		input: BrowserSessionCreateInput,
		source: BrowserSession["source"],
		profile: BrowserSession["profile"],
		signal?: AbortSignal,
	): Promise<BrowserSession> {
		if (profile.type === "persistent") {
			const existing = this.sessions.findPersistentProfile(input.namespace, profile.id);
			if (existing) {
				if (
					existing.session.source === source &&
					existing.session.headed === (input.headed ?? true) &&
					sameHosts(existing.allowedHosts, input.allowedHosts)
				) {
					this.logger.info("browser persistent session reused", {
						namespace: input.namespace,
						sessionRef: browserResourceRef(existing.session.id),
						profileRef: browserResourceRef(profile.id),
					});
					return existing.session;
				}
				this.logger.warn("browser persistent profile settings conflict", {
					namespace: input.namespace,
					sessionRef: browserResourceRef(existing.session.id),
					profileRef: browserResourceRef(profile.id),
				});
				throw new BrowserAutomationError(
					"invalid_request",
					"Browser profile is already active with different session settings",
				);
			}
		}
		const sessionId = `vetta-${randomUUID()}`;
		const resources = await this.profiles.prepareSession({
			namespace: input.namespace,
			sessionId,
			source,
			profile,
			headed: input.headed ?? true,
		});
		try {
			signal?.throwIfAborted();
		} catch (error) {
			await this.profiles.releaseSession(resources);
			throw error;
		}
		const record = this.sessions.create({
			namespace: input.namespace,
			source,
			profile,
			headed: input.headed ?? true,
			allowedHosts: input.allowedHosts,
			resources,
			sessionId,
		});
		this.logger.info("browser session created", {
			namespace: input.namespace,
			sessionRef: browserResourceRef(record.session.id),
			profileRef: profile.type === "persistent" ? browserResourceRef(profile.id) : "ephemeral",
			source,
			headed: record.session.headed,
		});
		return record.session;
	}

	getSession(input: BrowserSessionInput): BrowserSession {
		return this.sessions.get(input.namespace, input.sessionId).session;
	}

	async closeSession(input: BrowserSessionInput, signal?: AbortSignal): Promise<void> {
		const initialRecord = this.sessions.get(input.namespace, input.sessionId);
		const close = () =>
			this.sessions.runExclusive(input.namespace, input.sessionId, async (record) => {
				try {
					await this.engine.close(engineSession(record), signal);
				} catch (error) {
					this.logger.warn("browser engine close failed", {
						namespace: input.namespace,
						sessionRef: browserResourceRef(input.sessionId),
						errorCode: errorCode(error),
					});
				} finally {
					await this.profiles.releaseSession(record.resources);
					this.sessions.delete(input.namespace, input.sessionId);
					this.logger.info("browser session closed", {
						namespace: input.namespace,
						sessionRef: browserResourceRef(input.sessionId),
					});
				}
			});
		if (initialRecord.session.profile.type === "persistent") {
			await this.sessions.runPersistentProfileExclusive(input.namespace, initialRecord.session.profile.id, close);
			return;
		}
		await close();
	}

	async navigate(input: BrowserNavigateInput, signal?: AbortSignal): Promise<BrowserPageState> {
		return this.run(input.namespace, input.sessionId, "navigate", async (record) => {
			const allowed = assertAllowedBrowserUrl(input.url, record.allowedHosts);
			const result = await this.engine.navigate(engineSession(record), allowed.url, signal);
			assertReturnedPageAllowed(result.url, record.allowedHosts);
			this.updatePage(record, result.url, result.title, true);
			return this.pageState(record);
		});
	}

	async snapshot(input: BrowserSnapshotInput, signal?: AbortSignal): Promise<BrowserSnapshot> {
		return this.run(input.namespace, input.sessionId, "snapshot", async (record) => {
			const result = await this.engine.snapshot(engineSession(record), input.interactiveOnly ?? false, signal);
			assertReturnedPageAllowed(result.url, record.allowedHosts);
			this.updatePage(record, result.url, result.title, true);
			return { ...this.pageState(record), content: result.output ?? "" };
		});
	}

	async readText(input: BrowserReadTextInput, signal?: AbortSignal): Promise<BrowserTextContent> {
		return this.run(input.namespace, input.sessionId, "read-text", async (record) => {
			const result = await this.engine.readText(engineSession(record), signal);
			assertReturnedPageAllowed(result.url, record.allowedHosts);
			this.updatePage(record, result.url, result.title, false);
			const text = result.output ?? "";
			const maxChars = input.maxChars ?? 100_000;
			return {
				sessionId: record.session.id,
				url: record.currentUrl,
				title: record.currentTitle,
				text: text.slice(0, maxChars),
				truncated: text.length > maxChars,
			};
		});
	}

	async screenshot(input: BrowserScreenshotInput, signal?: AbortSignal): Promise<BrowserScreenshot> {
		return this.run(input.namespace, input.sessionId, "screenshot", async (record) => {
			const result = await this.engine.screenshot(engineSession(record), input.fullPage ?? false, signal);
			assertReturnedPageAllowed(result.url, record.allowedHosts);
			this.updatePage(record, result.url, result.title, false);
			return { sessionId: record.session.id, revision: record.revision, dataUrl: result.dataUrl };
		});
	}

	async act(input: BrowserActInput, signal?: AbortSignal): Promise<BrowserActionResult> {
		return this.run(input.namespace, input.sessionId, "act", async (record) => {
			if (input.snapshotRevision !== undefined && input.snapshotRevision !== record.revision) {
				this.logger.warn("browser stale snapshot rejected", {
					namespace: input.namespace,
					sessionRef: browserResourceRef(input.sessionId),
					expectedRevision: record.revision,
					actualRevision: input.snapshotRevision,
				});
				throw new BrowserAutomationError("stale_snapshot", "Browser snapshot is stale; take a new snapshot");
			}
			const result = await this.engine.act(engineSession(record), input.action, signal);
			try {
				assertReturnedPageAllowed(result.url, record.allowedHosts);
			} catch (error) {
				await this.containPolicyEscape(record);
				throw error;
			}
			this.updatePage(record, result.url, result.title, true);
			return { ...this.pageState(record), output: result.output };
		});
	}

	async closeAll(): Promise<void> {
		for (const record of this.sessions.list()) {
			await this.closeSession({ namespace: record.namespace, sessionId: record.session.id });
		}
	}

	async closeReleasedSessions(namespace: string, sessionIds: readonly string[]): Promise<void> {
		for (const sessionId of sessionIds) {
			try {
				await this.closeSession({ namespace, sessionId });
			} catch (error) {
				if (!(error instanceof BrowserAutomationError) || error.code !== "session_not_found") throw error;
			}
		}
	}

	private async run<T>(
		namespace: string,
		sessionId: string,
		operation: string,
		handler: (record: BrowserSessionRecord) => Promise<T>,
	): Promise<T> {
		const startedAt = Date.now();
		try {
			const initialRecord = this.sessions.get(namespace, sessionId);
			const execute = () => this.sessions.runExclusive(namespace, sessionId, handler);
			const result =
				initialRecord.session.profile.type === "persistent"
					? await this.sessions.runPersistentProfileExclusive(namespace, initialRecord.session.profile.id, execute)
					: await execute();
			this.logger.info("browser operation completed", {
				namespace,
				sessionRef: browserResourceRef(sessionId),
				operation,
				durationMs: Date.now() - startedAt,
			});
			return result;
		} catch (error) {
			this.logger.warn("browser operation failed", {
				namespace,
				sessionRef: browserResourceRef(sessionId),
				operation,
				durationMs: Date.now() - startedAt,
				errorCode: errorCode(error),
			});
			throw error;
		}
	}

	private updatePage(record: BrowserSessionRecord, url: string, title: string | undefined, increment: boolean): void {
		record.currentUrl = url;
		record.currentTitle = title;
		if (increment) record.revision += 1;
	}

	private pageState(record: BrowserSessionRecord): BrowserPageState {
		return {
			sessionId: record.session.id,
			revision: record.revision,
			url: record.currentUrl,
			title: record.currentTitle,
		};
	}

	private async containPolicyEscape(record: BrowserSessionRecord): Promise<void> {
		this.logger.error("browser session escaped allowed hosts", {
			namespace: record.namespace,
			sessionRef: browserResourceRef(record.session.id),
		});
		try {
			await this.engine.close(engineSession(record));
		} finally {
			await this.profiles.releaseSession(record.resources);
			this.sessions.delete(record.namespace, record.session.id);
		}
	}
}
