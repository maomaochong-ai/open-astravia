import { ActionRpcError } from "./errors.js";
import type { ActionRpcEndpoint, ActionRpcResponse, LocalRpcRequest } from "./types.js";

type ActionRpcSuccessResponse = Extract<ActionRpcResponse, { ok: true }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResponse(value: unknown): ActionRpcResponse {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.ok !== "boolean") {
		throw new ActionRpcError("ACTION_RPC_ERROR", "Action RPC returned an invalid response");
	}
	if (value.ok) {
		if (!("result" in value)) {
			throw new ActionRpcError("ACTION_RPC_ERROR", "Action RPC success response is missing result");
		}
		return value as ActionRpcResponse;
	}
	if (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string") {
		throw new ActionRpcError("ACTION_RPC_ERROR", "Action RPC error response is invalid");
	}
	return value as ActionRpcResponse;
}

async function send(endpoint: ActionRpcEndpoint, request: LocalRpcRequest): Promise<ActionRpcSuccessResponse> {
	const response = await fetch(new URL("/rpc", endpoint.url), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${endpoint.token}`,
		},
		body: JSON.stringify(request),
	});

	let rawPayload: unknown;
	try {
		rawPayload = await response.json();
	} catch {
		throw new ActionRpcError(
			"ACTION_RPC_ERROR",
			`Action RPC returned an invalid response (${response.status} ${response.statusText})`.trim(),
		);
	}
	const payload = parseResponse(rawPayload);
	if (!payload.ok) {
		throw new ActionRpcError(payload.error.code, payload.error.message, payload.error.details);
	}
	return payload;
}

export function createActionRpcClient(endpoint: ActionRpcEndpoint) {
	return {
		search: async (params: { query?: string; domain?: string } = {}) => {
			const response = await send(endpoint, {
				id: crypto.randomUUID(),
				method: "actions.search",
				params,
			});
			return response.result;
		},
		describe: async (actionId: string) => {
			const response = await send(endpoint, {
				id: crypto.randomUUID(),
				method: "actions.describe",
				params: { actionId },
			});
			return response.result;
		},
		run: async (actionId: string, input: unknown = {}) => {
			const response = await send(endpoint, {
				id: crypto.randomUUID(),
				method: "actions.run",
				params: { actionId, input },
			});
			return response.result;
		},
	};
}

export function createDebugRpcClient(endpoint: ActionRpcEndpoint) {
	return {
		search: async (params: { query?: string; category?: string } = {}) => {
			const response = await send(endpoint, {
				id: crypto.randomUUID(),
				method: "debug.search",
				params,
			});
			return response.result;
		},
		describe: async (debugId: string) => {
			const response = await send(endpoint, {
				id: crypto.randomUUID(),
				method: "debug.describe",
				params: { debugId },
			});
			return response.result;
		},
		run: async (debugId: string, input: unknown = {}) => {
			const response = await send(endpoint, {
				id: crypto.randomUUID(),
				method: "debug.run",
				params: { debugId, input },
			});
			return response.result;
		},
	};
}
