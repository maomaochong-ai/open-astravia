import { describe, expect, it, vi } from "vitest";
import { McpSetupLoginService } from "./mcp-setup-login-service";

const config = {
	type: "http",
	url: "http://127.0.0.1/mcp",
	managedRuntimeId: "demo-runtime",
	managedRuntimeEnv: { XHS_PROXY: "http://127.0.0.1:7890" },
} as const;
const spec = {
	schemaVersion: 2,
	id: "demo-runtime",
	command: "C:/runtime/demo.exe",
	args: [],
	env: {},
	mcpPath: "/mcp",
	readyTimeoutMs: 1000,
	configurableEnvKeys: ["XHS_PROXY"],
	setup: {
		kind: "http-qrcode",
		statusPath: "/api/v1/login/status",
		qrcodePath: "/api/v1/login/qrcode",
		logoutPath: "/api/v1/login/cookies",
	},
} as const;

function service(fetchImpl: typeof fetch, recordStatus = vi.fn()) {
	const ensureRuntime = vi.fn(async () => "http://127.0.0.1:23456/mcp");
	return {
		recordStatus,
		ensureRuntime,
		instance: new McpSetupLoginService({
			loadServerConfig: async () => config,
			readRuntimeSpec: async () => spec,
			ensureRuntime,
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
		const { instance, recordStatus, ensureRuntime } = service(fetchImpl);

		await expect(instance.getStatus("demo")).resolves.toEqual({ state: "unauthenticated" });
		expect(recordStatus).toHaveBeenCalledWith("demo-runtime", false);
		expect(ensureRuntime).toHaveBeenCalledWith("demo-runtime", config.managedRuntimeEnv);
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

		await expect(instance.start("demo", "qr-1")).resolves.toEqual({
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

		await expect(instance.start("demo", "qr-1")).resolves.toEqual({
			state: "authenticated",
			username: "小明",
		});
	});

	it("clears cookies through the declared upstream endpoint and verifies the resulting status", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(json({ message: "deleted" }))
			.mockResolvedValueOnce(json({ is_logged_in: false }));
		const { instance, recordStatus } = service(fetchImpl);

		await expect(instance.clear("demo")).resolves.toEqual({ state: "unauthenticated" });
		expect(fetchImpl).toHaveBeenNthCalledWith(
			1,
			new URL("http://127.0.0.1:23456/api/v1/login/cookies"),
			expect.objectContaining({ method: "DELETE" }),
		);
		expect(recordStatus).toHaveBeenCalledWith("demo-runtime", false);
	});

	it("cancels only the addressed QR request and leaves status checks running", async () => {
		let resolveStatus: ((response: Response) => void) | undefined;
		const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = String(input);
			if (url.endsWith("/status")) {
				return new Promise((resolve, reject) => {
					resolveStatus = resolve;
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
				});
			}
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
			});
		});
		const { instance } = service(fetchImpl as typeof fetch);
		const status = instance.getStatus("demo");
		const qr = instance.start("demo", "qr-1");
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

		await instance.cancel("qr-1");
		await expect(qr).resolves.toEqual({ state: "cancelled" });
		resolveStatus?.(json({ is_logged_in: false }));
		await expect(status).resolves.toEqual({ state: "unauthenticated" });
	});

	it("rejects ordinary HTTP MCP servers without a managed login contract", async () => {
		const instance = new McpSetupLoginService({
			loadServerConfig: async () => ({ type: "http", url: "https://example.com/mcp" }),
			fetchImpl: vi.fn(),
		});

		await expect(instance.getStatus("demo")).rejects.toThrow(/managed HTTP/);
	});
});
