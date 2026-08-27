import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserAction, BrowserRuntimeStatus } from "@vetta/capability-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAutomationService } from "./browser-automation-service.js";
import { BrowserProfileRegistry } from "./browser-profile-registry.js";
import type {
	BrowserAutomationLogger,
	BrowserEngine,
	BrowserEnginePageResult,
	BrowserEngineSession,
	BrowserProfilePort,
	BrowserRuntimePort,
} from "./contracts.js";

class FakeBrowserEngine implements BrowserEngine {
	url = "about:blank";
	nextActionUrl?: string;
	readonly calls: string[] = [];

	async navigate(_session: BrowserEngineSession, url: string): Promise<BrowserEnginePageResult> {
		this.calls.push("navigate");
		this.url = url;
		return { url, title: "Page" };
	}

	async snapshot(): Promise<BrowserEnginePageResult> {
		this.calls.push("snapshot");
		return { url: this.url, title: "Page", output: "button Submit [ref=@e1]" };
	}

	async readText(): Promise<BrowserEnginePageResult> {
		this.calls.push("readText");
		return { url: this.url, title: "Page", output: "page content" };
	}

	async screenshot(): Promise<BrowserEnginePageResult & { dataUrl: string }> {
		this.calls.push("screenshot");
		return { url: this.url, dataUrl: "data:image/png;base64,AA==" };
	}

	async act(_session: BrowserEngineSession, _action: BrowserAction): Promise<BrowserEnginePageResult> {
		this.calls.push("act");
		this.url = this.nextActionUrl ?? this.url;
		return { url: this.url, output: "ok" };
	}

	async close(): Promise<void> {
		this.calls.push("close");
	}
}

function readyRuntime(): BrowserRuntimePort {
	const status: BrowserRuntimeStatus = { phase: "ready", version: "0.34.0" };
	return { status: async () => status, install: async () => status };
}

describe("BrowserAutomationService", () => {
	let temporaryDirectory: string;
	let engine: FakeBrowserEngine;
	let logger: BrowserAutomationLogger;
	let service: BrowserAutomationService;

	beforeEach(async () => {
		temporaryDirectory = await mkdtemp(join(tmpdir(), "vetta-browser-service-test-"));
		engine = new FakeBrowserEngine();
		logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
		service = new BrowserAutomationService({
			engine,
			runtime: readyRuntime(),
			profiles: new BrowserProfileRegistry({ baseDirectory: temporaryDirectory }),
			logger,
		});
	});

	afterEach(async () => {
		await rm(temporaryDirectory, { recursive: true, force: true });
	});

	it("isolates sessions by namespace and rejects navigation before invoking the engine", async () => {
		const session = await service.createSession({ namespace: "publisher-a", allowedHosts: ["example.com"] });
		expect(() => service.getSession({ namespace: "publisher-b", sessionId: session.id })).toThrowError(
			expect.objectContaining({ code: "session_forbidden" }),
		);
		await expect(
			service.navigate({ namespace: "publisher-a", sessionId: session.id, url: "https://blocked.example.net" }),
		).rejects.toMatchObject({ code: "policy_denied" });
		expect(engine.calls).not.toContain("navigate");
	});

	it("revisions snapshots and rejects actions based on stale references", async () => {
		const session = await service.createSession({ namespace: "publisher", allowedHosts: ["example.com"] });
		await service.navigate({ namespace: "publisher", sessionId: session.id, url: "https://example.com/editor" });
		const first = await service.snapshot({ namespace: "publisher", sessionId: session.id });
		const second = await service.snapshot({ namespace: "publisher", sessionId: session.id });
		expect(second.revision).toBe(first.revision + 1);
		await expect(
			service.act({
				namespace: "publisher",
				sessionId: session.id,
				snapshotRevision: first.revision,
				action: { type: "click", target: "@e1" },
			}),
		).rejects.toMatchObject({ code: "stale_snapshot" });
		expect(engine.calls.filter((call) => call === "act")).toHaveLength(0);
	});

	it("contains a cross-host redirect after an opaque interaction and logs no form values", async () => {
		const session = await service.createSession({ namespace: "publisher", allowedHosts: ["example.com"] });
		await service.navigate({ namespace: "publisher", sessionId: session.id, url: "https://example.com/editor" });
		const snapshot = await service.snapshot({ namespace: "publisher", sessionId: session.id });
		engine.nextActionUrl = "https://escape.example.net/collect?token=hidden";
		await expect(
			service.act({
				namespace: "publisher",
				sessionId: session.id,
				snapshotRevision: snapshot.revision,
				action: { type: "fill", target: "@e1", value: "DO_NOT_LOG_THIS" },
			}),
		).rejects.toMatchObject({ code: "policy_denied" });
		expect(engine.calls).toContain("close");
		expect(() => service.getSession({ namespace: "publisher", sessionId: session.id })).toThrowError(
			expect.objectContaining({ code: "session_not_found" }),
		);
		const logCalls = [logger.info, logger.warn, logger.error].flatMap((method) => vi.mocked(method).mock.calls);
		expect(JSON.stringify(logCalls)).not.toContain("DO_NOT_LOG_THIS");
		expect(JSON.stringify(logCalls)).not.toContain("token=hidden");
	});

	it("reports runtime readiness instead of creating a partial session", async () => {
		const unavailable = new BrowserAutomationService({
			engine,
			runtime: { status: async () => ({ phase: "missing" }), install: async () => ({ phase: "missing" }) },
			profiles: new BrowserProfileRegistry({ baseDirectory: temporaryDirectory }),
			logger,
		});
		await expect(unavailable.createSession({ namespace: "publisher", allowedHosts: ["*"] })).rejects.toMatchObject({
			code: "runtime_not_ready",
		});
	});

	it("reuses one active persistent profile and rejects conflicting live settings", async () => {
		const first = await service.createSession({
			namespace: "publisher",
			profile: { type: "persistent", id: "brand-a" },
			allowedHosts: ["example.com"],
		});
		const reused = await service.createSession({
			namespace: "publisher",
			profile: { type: "persistent", id: "brand-a" },
			allowedHosts: ["example.com"],
		});
		expect(reused.id).toBe(first.id);
		await expect(
			service.createSession({
				namespace: "publisher",
				profile: { type: "persistent", id: "brand-a" },
				allowedHosts: ["other.example"],
			}),
		).rejects.toMatchObject({ code: "invalid_request" });
	});

	it("serializes concurrent creation of the same persistent profile", async () => {
		let prepareCalls = 0;
		let releaseFirst: () => void = () => undefined;
		let markFirstPrepared: () => void = () => undefined;
		const firstPrepared = new Promise<void>((resolve) => {
			markFirstPrepared = resolve;
		});
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const profiles: BrowserProfilePort = {
			prepareSession: async ({ sessionId }) => {
				prepareCalls += 1;
				if (prepareCalls === 1) {
					markFirstPrepared();
					await firstGate;
				}
				return {
					configPath: join(temporaryDirectory, `${sessionId}.json`),
					profilePath: join(temporaryDirectory, "brand-a"),
					sessionDirectory: join(temporaryDirectory, sessionId),
					persistentProfile: true,
				};
			},
			releaseSession: async () => undefined,
		};
		const concurrentService = new BrowserAutomationService({
			engine,
			runtime: readyRuntime(),
			profiles,
			logger,
		});
		const create = () =>
			concurrentService.createSession({
				namespace: "publisher",
				profile: { type: "persistent", id: "brand-a" },
				allowedHosts: ["example.com"],
			});
		const first = create();
		await firstPrepared;
		const second = create();
		await Promise.resolve();
		releaseFirst();
		const [firstSession, secondSession] = await Promise.all([first, second]);

		expect(prepareCalls).toBe(1);
		expect(secondSession.id).toBe(firstSession.id);
	});
});
