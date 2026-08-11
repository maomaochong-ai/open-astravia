import type { Api, Model } from "@vetta/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodingAgentHostFromSessionFactory } from "../../src/host/coding-agent-host.js";
import {
	AuthStorage,
	createCodingAgentHostWithServices,
	createCodingAgentModelRuntime,
	SettingsRuntime,
} from "../../src/public-api/host-services.js";
import type { CodingAgentHost, CodingAgentSession, CreateCodingAgentSessionResult } from "../../src/public-api/sdk.js";

describe("Coding Agent Host", () => {
	const hosts: CodingAgentHost[] = [];

	afterEach(async () => {
		await Promise.allSettled(hosts.map((host) => host.close()));
	});

	it("waits for an admitted Session creation and then closes the created Session", async () => {
		let finishCreation: ((result: CreateCodingAgentSessionResult) => void) | undefined;
		const closeSession = vi.fn(async () => undefined);
		const host = createCodingAgentHostFromSessionFactory({}, async () => {
			return new Promise<CreateCodingAgentSessionResult>((resolve) => {
				finishCreation = resolve;
			});
		});
		hosts.push(host);

		const creation = host.createSession();
		const closing = host.close();
		finishCreation?.({ session: fakeSession(closeSession), diagnostics: [] });

		await expect(creation).resolves.toBeDefined();
		await expect(closing).resolves.toBeUndefined();
		expect(closeSession).toHaveBeenCalledOnce();
		await expect(host.createSession()).rejects.toThrow("CodingAgentHost is closing or closed");
	});

	it("retries only Sessions whose close operation failed", async () => {
		const firstClose = vi.fn(async () => undefined);
		const secondClose = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("close failed"))
			.mockResolvedValueOnce(undefined);
		let created = 0;
		const host = createCodingAgentHostFromSessionFactory({}, async (_options, lifecycle) => {
			created += 1;
			const close = created === 1 ? firstClose : secondClose;
			return {
				session: fakeSession(async () => {
					await close();
					lifecycle.onClosed();
				}),
				diagnostics: [],
			};
		});
		hosts.push(host);
		await host.createSession();
		await host.createSession();

		await expect(host.close()).rejects.toThrow("CodingAgentHost failed to close all Sessions");
		expect(firstClose).toHaveBeenCalledOnce();
		expect(secondClose).toHaveBeenCalledOnce();

		await expect(host.close()).resolves.toBeUndefined();
		expect(firstClose).toHaveBeenCalledOnce();
		expect(secondClose).toHaveBeenCalledTimes(2);
	});

	it("adapts shared host services without exposing them on Session", async () => {
		const authStorage = AuthStorage.inMemory();
		const modelRuntime = createCodingAgentModelRuntime(authStorage);
		const settingsManager = SettingsRuntime.inMemory();
		settingsManager.setDefaultThinkingLevel("high");
		const host = createCodingAgentHostWithServices({
			authStorage,
			modelRuntime,
			settings: settingsManager,
			sessionDefaults: {
				model: MODEL,
				activeTools: [],
				enableMcp: false,
				enableSubagents: false,
				includeAgentSkills: false,
			},
		});
		hosts.push(host);

		const first = await host.createSession({ storage: { kind: "memory", sessionId: "host-first" } });
		const second = await host.createSession({ storage: { kind: "memory", sessionId: "host-second" } });

		expect(first.session.thinkingLevel).toBe("high");
		expect(second.session.thinkingLevel).toBe("high");
		for (const concrete of ["modelRegistry", "settingsManager", "sessionManager", "resourceLoader"]) {
			expect(Reflect.has(first.session, concrete)).toBe(false);
		}

		await first.session.close();
		await host.close();
		await expect(second.session.prompt("closed")).rejects.toThrow("AgentSession is closed");
	});
});

function fakeSession(close: () => Promise<void>): CodingAgentSession {
	return { close } as unknown as CodingAgentSession;
}

const MODEL: Model<Api> = {
	id: "host-model",
	name: "Host Model",
	api: "openai-responses",
	provider: "host-provider",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
