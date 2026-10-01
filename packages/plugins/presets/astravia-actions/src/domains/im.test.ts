import { describe, expect, it, vi } from "vitest";
import { registerImActions } from "./im";

type Registered = {
	id: string;
	publicId?: string;
	handler: (args: { input: unknown; signal: AbortSignal }) => Promise<unknown>;
	assertReady?: (args: { input: unknown; signal: AbortSignal }) => Promise<void>;
};

function createMockCtx() {
	const registered: Registered[] = [];
	const official = {
		im: {
			getStatus: vi.fn().mockResolvedValue({ enabled: true, transport: "feishu" }),
			getLogs: vi.fn().mockResolvedValue([]),
			setEnabled: vi.fn().mockResolvedValue({ status: { ok: true } }),
			restart: vi.fn().mockResolvedValue({ status: { ok: true } }),
			setAgentModel: vi.fn().mockResolvedValue({ status: { ok: true } }),
			assertModelKeyExists: vi.fn().mockResolvedValue(undefined),
			setFeishuConfig: vi.fn().mockResolvedValue({ ok: true }),
		},
	};
	const ctx = {
		official,
		appActions: {
			register: (def: Registered) => {
				registered.push(def);
			},
		},
	};
	return { ctx: ctx as never, registered, official };
}

describe("registerImActions", () => {
	it("registers query and manage actions", () => {
		const { ctx, registered } = createMockCtx();
		registerImActions(ctx);
		expect(registered.map((item) => item.publicId)).toEqual(["im.query", "im.manage"]);
	});

	it("set-feishu-config forwards non-secret fields and omittable secrets", async () => {
		const { ctx, registered, official } = createMockCtx();
		registerImActions(ctx);
		const manage = registered.find((item) => item.id === "im.manage");
		const signal = new AbortController().signal;
		await expect(
			manage?.handler({
				input: {
					operation: "set-feishu-config",
					appId: "cli_xxx",
					appSecret: "user-filled-secret",
				},
				signal,
			}),
		).resolves.toEqual({ operation: "set-feishu-config", ok: true });
		expect(official.im.setFeishuConfig).toHaveBeenCalledWith({
			appId: "cli_xxx",
			appSecret: "user-filled-secret",
			verificationToken: undefined,
			encryptKey: undefined,
			baseUrl: undefined,
			enabled: undefined,
		});
	});

	it("set-agent-model validates model key format before approval", async () => {
		const { ctx, registered } = createMockCtx();
		registerImActions(ctx);
		const manage = registered.find((item) => item.id === "im.manage");
		const signal = new AbortController().signal;
		await expect(
			manage?.assertReady?.({ input: { operation: "set-agent-model", modelKey: "bad" }, signal }),
		).rejects.toMatchObject({ code: "ACTION_INVALID_INPUT" });
	});
});
