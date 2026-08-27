import type {
	PluginBrowserApi,
	PluginBrowserSession,
	PluginBrowserSessionOptions,
} from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { BrowserSessionBroker } from "../src/agent/browser-session-broker";

function createHarness(): {
	browser: PluginBrowserApi;
	created: PluginBrowserSessionOptions[];
	closed: string[];
} {
	const sessions = new Map<string, PluginBrowserSession>();
	const created: PluginBrowserSessionOptions[] = [];
	const closed: string[] = [];
	let sequence = 0;
	const browser: PluginBrowserApi = {
		runtime: {
			status: async () => ({ phase: "ready", version: "0.34.0" }),
			install: async () => ({ phase: "ready", version: "0.34.0" }),
		},
		sessions: {
			create: async (options = {}) => {
				created.push(options);
				const session: PluginBrowserSession = {
					id: `s-${++sequence}`,
					source: options.source ?? "managed",
					profile: options.profile ?? { type: "ephemeral" },
					headed: options.headed ?? true,
					status: "ready",
					createdAt: sequence,
				};
				sessions.set(session.id, session);
				return session;
			},
			get: async (id) => {
				const session = sessions.get(id);
				if (!session) throw new Error("missing");
				return session;
			},
			close: async (id) => {
				closed.push(id);
				sessions.delete(id);
			},
		},
		navigate: vi.fn(async (sessionId: string, url: string) => ({ sessionId, revision: 1, url })),
		snapshot: vi.fn(async (sessionId: string) => ({
			sessionId,
			revision: 2,
			url: "https://example.com",
			content: "a".repeat(2_500),
		})),
		readText: vi.fn(async (sessionId: string) => ({
			sessionId,
			url: "https://example.com",
			text: "body",
			truncated: false,
		})),
		screenshot: vi.fn(),
		act: vi.fn(async (sessionId: string) => ({ sessionId, revision: 3, url: "https://example.com" })),
	};
	return { browser, created, closed };
}

const defaults = { browserSource: "managed", headed: true, allowedDomains: "", maxOutput: 2_000 };

describe("BrowserSessionBroker", () => {
	it("用 profileId 隔离多个媒体账号，并为托管浏览器选择持久 profile", async () => {
		const { browser, created } = createHarness();
		const broker = new BrowserSessionBroker(browser);
		await broker.execute({ operation: "navigate", profileId: "brand-a", url: "https://example.com/a" }, defaults);
		await broker.execute({ operation: "navigate", profileId: "brand-b", url: "https://example.com/b" }, defaults);
		expect(created.map((options) => options.profile)).toEqual([
			{ type: "persistent", id: "brand-a" },
			{ type: "persistent", id: "brand-b" },
		]);
	});

	it("同一 profile 复用 session，设置变化时先关闭再重建但不删除持久 profile", async () => {
		const { browser, created, closed } = createHarness();
		const broker = new BrowserSessionBroker(browser);
		await broker.execute({ operation: "snapshot", profileId: "brand" }, defaults);
		await broker.execute({ operation: "snapshot", profileId: "brand" }, defaults);
		expect(created).toHaveLength(1);
		await broker.execute(
			{ operation: "snapshot", profileId: "brand" },
			{ ...defaults, allowedDomains: "studio.example.com" },
		);
		expect(closed).toEqual(["s-1"]);
		expect(created).toHaveLength(2);
		expect(created[1].allowedHosts).toEqual(["studio.example.com"]);
	});

	it("插件输出上限同时约束 snapshot 与 read_text", async () => {
		const { browser } = createHarness();
		const broker = new BrowserSessionBroker(browser);
		const snapshot = await broker.execute({ operation: "snapshot" }, defaults);
		expect(snapshot).toMatchObject({ truncated: true });
		expect((snapshot as { content: string }).content).toHaveLength(2_000);
		await broker.execute({ operation: "read_text", maxChars: 10_000 }, defaults);
		expect(browser.readText).toHaveBeenLastCalledWith("s-1", { maxChars: 2_000 });
	});

	it("附着模式不请求宿主持久 profile", async () => {
		const { browser, created } = createHarness();
		await new BrowserSessionBroker(browser).execute(
			{ operation: "navigate", profileId: "shared-chrome", url: "https://example.com" },
			{ ...defaults, browserSource: "attach" },
		);
		expect(created[0].profile).toEqual({ type: "ephemeral" });
	});

	it("拒绝把敏感或不稳定文本塞进 profileId", async () => {
		const { browser } = createHarness();
		await expect(
			new BrowserSessionBroker(browser).execute(
				{ operation: "navigate", profileId: "person@example.com", url: "https://example.com" },
				defaults,
			),
		).rejects.toThrow("profileId");
	});
});
