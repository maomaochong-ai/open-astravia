import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfficialImApi } from "./plugin-official-im.js";

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

describe("createOfficialImApi", () => {
	it("routes IM operations through the capability session", async () => {
		const runtime = { transport: "online", activeSessions: 1, consecutiveStartFailures: 0 };
		const status = {
			enabled: true,
			transport: "feishu",
			agentModel: { provider: "openai", model: "gpt-5" },
			wechatBound: false,
			feishuAppId: "app-id",
			runtime,
		};
		const logs = [{ level: "info", msg: "started", time: "2026-07-24T00:00:00.000Z" }];
		const im = {
			getStatus: vi.fn().mockResolvedValue(status),
			listLogs: vi.fn().mockResolvedValue(logs),
			setEnabled: vi.fn().mockResolvedValue(runtime),
			restart: vi.fn().mockResolvedValue(runtime),
			setAgentModel: vi.fn().mockResolvedValue(runtime),
		};
		const models = {
			validateModelKey: vi.fn().mockResolvedValue(undefined),
		};
		const hostIm = {
			getConfig: vi.fn().mockResolvedValue({
				enabled: true,
				transport: "feishu",
				feishu: { appId: "old", appSecret: "hidden", verificationToken: "", encryptKey: "" },
			}),
			setConfig: vi.fn().mockResolvedValue({ ok: true }),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: {
				vetta: {
					plugins: { internalCapabilities: { im, models } },
					im: hostIm,
				},
			},
		});
		const assertOfficial = vi.fn();
		const api = createOfficialImApi(assertOfficial, "capability-session");

		await expect(api.getStatus()).resolves.toEqual(status);
		await expect(api.getLogs()).resolves.toEqual(logs);
		await expect(api.setEnabled(true)).resolves.toEqual({ status: runtime });
		await expect(api.restart()).resolves.toEqual({ status: runtime });
		await expect(api.setAgentModel("openai/gpt-5", "high")).resolves.toEqual({ status: runtime });
		await expect(api.assertModelKeyExists("openai/gpt-5")).resolves.toBeUndefined();
		await expect(api.setFeishuConfig({ appId: "cli_new", appSecret: "s3cret" })).resolves.toEqual({ ok: true });

		expect(assertOfficial).toHaveBeenCalledTimes(7);
		expect(im.getStatus).toHaveBeenCalledWith("capability-session");
		expect(im.listLogs).toHaveBeenCalledWith("capability-session", 50);
		expect(im.setEnabled).toHaveBeenCalledWith("capability-session", true);
		expect(im.restart).toHaveBeenCalledWith("capability-session");
		expect(im.setAgentModel).toHaveBeenCalledWith("capability-session", "openai/gpt-5", "high");
		expect(models.validateModelKey).toHaveBeenCalledWith("capability-session", "openai/gpt-5", "set-agent-model");
		expect(hostIm.setConfig).toHaveBeenCalledWith({
			enabled: true,
			transport: "feishu",
			feishu: { appId: "cli_new", appSecret: "s3cret" },
		});
	});
});
