import { afterEach, describe, expect, it, vi } from "vitest";
import { type ActionRpcError, createActionRpcClient } from "../src/index.js";

const endpoint = { transport: "http" as const, url: "http://127.0.0.1:4321", token: "token" };

afterEach(() => vi.restoreAllMocks());

describe("Action RPC client response boundary", () => {
	it("preserves structured errors returned by a remote action server", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							id: "request-1",
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
					new Response(JSON.stringify({ id: "request-1", ok: false }), {
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
});
