import { rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserAutomationService } from "./browser-automation-service.js";
import { BrowserProfileRegistry } from "./browser-profile-registry.js";
import { BrowserSessionRegistry } from "./browser-session-registry.js";
import { BrowserAutomationError } from "./contracts.js";

async function cleanupRoot() {
	try {
		await rm(`${process.env.HOME}/.astravia/browser-automation`, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

describe("BrowserAutomationService", () => {
	beforeEach(cleanupRoot);

	const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

	function makeEngine(overrides: Record<string, unknown> = {}) {
		return {
			navigate: vi.fn().mockResolvedValue({ url: "https://github.com/astravia-core/astravia", title: "Vetta" }),
			snapshot: vi
				.fn()
				.mockResolvedValue({ url: "https://github.com/astravia-core/astravia", output: "snapshot content" }),
			readText: vi.fn().mockResolvedValue({ url: "https://github.com/astravia-core/astravia", output: "page text" }),
			screenshot: vi.fn().mockResolvedValue({
				url: "https://github.com/astravia-core/astravia",
				dataUrl: "data:image/png;base64,x",
			}),
			act: vi.fn().mockResolvedValue({ url: "https://github.com/astravia-core/astravia", output: "clicked" }),
			close: vi.fn().mockResolvedValue(undefined),
			...overrides,
		};
	}

	it("createSession followed by navigate, snapshot, act, close", async () => {
		const engine = makeEngine();
		const service = new BrowserAutomationService({
			engine,
			runtime: { status: vi.fn().mockResolvedValue({ phase: "ready" }), install: vi.fn() },
			profiles: new BrowserProfileRegistry(),
			sessions: new BrowserSessionRegistry(),
			logger,
		});
		const session = await service.createSession({ namespace: "ns", allowedHosts: ["*"] });
		expect(session.id).toMatch(/^astravia-/);

		const page1 = await service.navigate({
			namespace: "ns",
			sessionId: session.id,
			url: "https://github.com/astravia-core/astravia",
		});
		expect(page1.revision).toBe(1);

		const snap = await service.snapshot({ namespace: "ns", sessionId: session.id });
		expect(snap.revision).toBe(1);

		const page2 = await service.act({
			namespace: "ns",
			sessionId: session.id,
			action: { type: "click", target: "@e1" },
		});
		expect(page2.revision).toBe(2);

		await service.closeSession({ namespace: "ns", sessionId: session.id });
		expect(engine.close).toHaveBeenCalled();
	});

	it("rejects stale snapshot revision", async () => {
		const engine = makeEngine();
		const service = new BrowserAutomationService({
			engine,
			runtime: { status: vi.fn(), install: vi.fn() },
			profiles: new BrowserProfileRegistry(),
			sessions: new BrowserSessionRegistry(),
			logger,
		});
		const session = await service.createSession({ namespace: "ns", allowedHosts: ["*"] });
		await service.navigate({ namespace: "ns", sessionId: session.id, url: "https://github.com" }); // rev 1
		// try to act with stale revision 0
		await expect(
			service.act({
				namespace: "ns",
				sessionId: session.id,
				snapshotRevision: 0,
				action: { type: "click", target: "@e1" },
			}),
		).rejects.toBeInstanceOf(BrowserAutomationError);
	});

	it("rejects policy escape on navigate", async () => {
		const engine = makeEngine();
		const service = new BrowserAutomationService({
			engine,
			runtime: { status: vi.fn(), install: vi.fn() },
			profiles: new BrowserProfileRegistry(),
			sessions: new BrowserSessionRegistry(),
			logger,
		});
		const session = await service.createSession({
			namespace: "ns",
			allowedHosts: ["github.com"],
		});
		await expect(
			service.navigate({
				namespace: "ns",
				sessionId: session.id,
				url: "https://evil.com/x",
			}),
		).rejects.toBeInstanceOf(BrowserAutomationError);
	});

	it("readText respects maxChars truncation", async () => {
		const engine = makeEngine({
			readText: vi.fn().mockResolvedValue({ url: "https://github.com", output: "hello world page text here" }),
		});
		const service = new BrowserAutomationService({
			engine,
			runtime: { status: vi.fn(), install: vi.fn() },
			profiles: new BrowserProfileRegistry(),
			sessions: new BrowserSessionRegistry(),
			logger,
		});
		const session = await service.createSession({ namespace: "ns", allowedHosts: ["*"] });
		await service.navigate({ namespace: "ns", sessionId: session.id, url: "https://github.com" });
		const result = await service.readText({
			namespace: "ns",
			sessionId: session.id,
			maxChars: 5,
		});
		expect(result.text.length).toBe(5);
		expect(result.truncated).toBe(true);
	});
});
