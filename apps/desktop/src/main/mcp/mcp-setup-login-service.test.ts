import { describe, expect, it, vi } from "vitest";
import { McpSetupLoginService } from "./mcp-setup-login-service";

const config = { type: "http", url: "http://127.0.0.1/mcp", managedRuntimeId: "demo-runtime" } as const;
const spec = {
	schemaVersion: 1,
	id: "demo-runtime",
	command: "C:/runtime/demo.exe",
	args: [],
	env: {},
	mcpPath: "/mcp",
	readyTimeoutMs: 1000,
	setup: {
		kind: "http-qrcode",
		statusPath: "/api/v1/login/status",
		qrcodePath: "/api/v1/login/qrcode",
		logoutPath: "/api/v1/login/cookies",
	},
} as const;

function service(fetchImpl: typeof fetch, recordStatus = vi.fn()) {
	return {
		recordStatus,
		instance: new McpSetupLoginService({
			loadServerConfig: async () => config,
			readRuntimeSpec: async () => spec,
			ensureRuntime: async () => "http://127.0.0.1:23456/mcp",
			recordStatus,
			fetchImpl,
		}),
	};
}

function json(data: Record<string, unknown>): Response {
	return Response.json({ success: true, data, message: "ok" });
}

describe("McpSetupLoginService", () => {
	it("uses upstream is_logged_in as the only status result", async () => {
		const fetchImpl = vi.fn(async () => json({ is_logged_in: false }));
		const { instance, recordStatus } = service(fetchImpl);

		await expect(instance.getStatus("demo")).resolves.toEqual({ state: "unauthenticated" });
		expect(recordStatus).toHaveBeenCalledWith("demo-runtime", false);
		expect(fetchImpl).toHaveBeenCalledWith(
			new URL("http://127.0.0.1:23456/api/v1/login/status"),
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("returns upstream account identity for an authenticated session", async () => {
		const { instance, recordStatus } = service(
			vi.fn(async () => json({ is_logged_in: true, username: "小明", user_id: "user-1" })),
		);

		await expect(instance.getStatus("demo")).resolves.toEqual({
			state: "authenticated",
			username: "小明",
			userId: "user-1",
		});
		expect(recordStatus).toHaveBeenCalledWith("demo-runtime", true);
	});

	it("returns the QR code and parses the upstream Go duration", async () => {
		const image = "data:image/png;base64,iVBORw0KGgo=";
		const fetchImpl = vi.fn(async () => json({ is_logged_in: false, img: image, timeout: "4m0s" }));
		const { instance } = service(fetchImpl);

		await expect(instance.start("demo")).resolves.toEqual({
			state: "qr_code",
			image,
			expiresInSeconds: 240,
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			new URL("http://127.0.0.1:23456/api/v1/login/qrcode"),
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("does not invent a QR flow when the upstream QR endpoint reports already logged in", async () => {
		const { instance } = service(vi.fn(async () => json({ is_logged_in: true, username: "小明" })));

		await expect(instance.start("demo")).resolves.toEqual({ state: "authenticated", username: "小明" });
	});

	it("rejects ordinary HTTP MCP servers without a managed login contract", async () => {
		const instance = new McpSetupLoginService({
			loadServerConfig: async () => ({ type: "http", url: "https://example.com/mcp" }),
			fetchImpl: vi.fn(),
		});

		await expect(instance.getStatus("demo")).rejects.toThrow(/managed HTTP/);
	});
});
