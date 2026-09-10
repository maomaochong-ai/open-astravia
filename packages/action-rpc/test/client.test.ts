import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ActionRpcError, createActionRpcClient } from "../src/index.js";

const endpoint = { transport: "http" as const, url: "http://127.0.0.1:4321", token: "token" };
const requestId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => vi.stubGlobal("crypto", { randomUUID: () => requestId }));
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("Action RPC client response boundary", () => {
	it("preserves structured errors returned by a remote action server", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							id: requestId,
							ok: false,
							error: {
								code: "ACTION_INVALID_INPUT",
								message: "invalid action input",
								details: { field: "mode" },
							},
						}),
						{ status: 400, headers: { "Content-Type": "application/json" } },
					),
			),
		);

		await expect(createActionRpcClient(endpoint).run("appearance.theme", { type: "set" })).rejects.toMatchObject({
			name: "ActionRpcError",
			code: "ACTION_INVALID_INPUT",
			message: "invalid action input",
			details: { field: "mode" },
		});
	});

	it("turns malformed or non-JSON server responses into an ActionRpcError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("upstream failure", { status: 502 })),
		);

		await expect(createActionRpcClient(endpoint).search()).rejects.toMatchObject<ActionRpcError>({
			name: "ActionRpcError",
			code: "ACTION_RPC_ERROR",
		});
	});

	it("rejects JSON responses without an error contract instead of throwing TypeError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ id: requestId, ok: false }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);

		await expect(createActionRpcClient(endpoint).search()).rejects.toMatchObject({
			name: "ActionRpcError",
			code: "ACTION_RPC_ERROR",
			message: "Action RPC error response is invalid",
		});
	});

	it("turns transport failures into an ActionRpcError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		);

		await expect(createActionRpcClient(endpoint).search()).rejects.toMatchObject({
			name: "ActionRpcError",
			code: "ACTION_RPC_UNREACHABLE",
			message: "Action RPC request failed: fetch failed",
		});
	});

	it("rejects a response that does not match the request id", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ id: "another-request", ok: true, result: {} }), {
						headers: { "Content-Type": "application/json" },
					}),
			),
		);

		await expect(createActionRpcClient(endpoint).search()).rejects.toMatchObject({
			name: "ActionRpcError",
			code: "ACTION_RPC_ERROR",
			message: "Action RPC returned a response for a different request",
		});
	});
});
