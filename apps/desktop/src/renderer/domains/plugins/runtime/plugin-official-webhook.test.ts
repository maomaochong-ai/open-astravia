import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialWebhookApi } from "./plugin-official-webhook.js";

const endpoint = {
	id: "endpoint",
	kind: "feishu" as const,
	name: "Release",
	enabled: true,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialWebhookApi", () => {
	it("uses the plugin capability session and keeps the public facade", async () => {
		const webhook = {
			listEndpoints: vi.fn().mockResolvedValue([endpoint]),
			createEndpoint: vi.fn().mockResolvedValue(endpoint),
			sendMessage: vi.fn().mockResolvedValue({ ok: true }),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { webhook } } } },
		});
		const assertOfficial = vi.fn();
		const api = createOfficialWebhookApi(assertOfficial, "capability-session");
		const input = {
			kind: "feishu" as const,
			name: "Release",
			webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/example",
		};

		await expect(api.list()).resolves.toEqual([endpoint]);
		await expect(api.create(input)).resolves.toEqual(endpoint);
		await expect(api.send("endpoint", { text: "hello" })).resolves.toEqual({ ok: true });

		expect(assertOfficial).toHaveBeenCalledTimes(3);
		expect(webhook.listEndpoints).toHaveBeenCalledWith("capability-session");
		expect(webhook.createEndpoint).toHaveBeenCalledWith("capability-session", input);
		expect(webhook.sendMessage).toHaveBeenCalledWith("capability-session", "endpoint", { text: "hello" });
	});
});
