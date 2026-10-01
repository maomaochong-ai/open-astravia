import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { ActionRpcError } from "./errors.js";
import { parseLocalRpcRequest } from "./protocol.js";
import type {
	ActionRpcEndpoint,
	ActionRpcErrorBody,
	ActionRpcResponse,
	ActionRpcRuntime,
	LocalRpcRuntime,
} from "./types.js";

export interface LocalRpcServerHandle {
	endpoint: ActionRpcEndpoint;
	close: () => Promise<void>;
}

export interface StartLocalRpcServerOptions {
	host?: string;
	port?: number;
	token: string;
}

export type ActionRpcServerHandle = LocalRpcServerHandle;
export type StartActionRpcServerOptions = StartLocalRpcServerOptions;

function errorBody(err: unknown): ActionRpcErrorBody {
	if (err instanceof ActionRpcError) {
		return {
			code: err.code,
			message: err.message,
			details: err.details,
		};
	}
	if (err instanceof Error) {
		return {
			code: "ACTION_RPC_ERROR",
			message: err.message,
		};
	}
	return {
		code: "ACTION_RPC_ERROR",
		message: "Unknown action RPC error",
	};
}

function getBearerToken(value: string | undefined): string | undefined {
	const prefix = "Bearer ";
	if (!value?.startsWith(prefix)) return undefined;
	return value.slice(prefix.length);
}

async function dispatch(
	runtime: LocalRpcRuntime,
	request: ReturnType<typeof parseLocalRpcRequest>,
	signal: AbortSignal,
) {
	if (request.method === "actions.search") {
		return await runtime.actions.search({
			query: request.params?.query,
			domain: request.params?.domain,
		});
	}
	if (request.method === "actions.describe") {
		return await runtime.actions.describe(request.params.actionId);
	}
	if (request.method === "actions.run") {
		return await runtime.actions.run(request.params.actionId, request.params.input ?? {}, {
			requestId: request.id,
			signal,
		});
	}
	if (!runtime.debug) {
		throw new ActionRpcError("DEBUG_NOT_AVAILABLE", "Astravia Debug is only available in development mode.");
	}
	if (request.method === "debug.search") {
		return await runtime.debug.search({
			query: request.params?.query,
			category: request.params?.category,
		});
	}
	if (request.method === "debug.describe") {
		return await runtime.debug.describe(request.params.debugId);
	}
	return await runtime.debug.run(request.params.debugId, request.params.input ?? {}, {
		requestId: request.id,
		signal,
	});
}

export async function startLocalRpcServer(
	runtime: LocalRpcRuntime,
	options: StartLocalRpcServerOptions,
): Promise<LocalRpcServerHandle> {
	const host = options.host ?? "127.0.0.1";
	const app = new Hono();

	app.get("/health", (c) => c.json({ ok: true }));
	app.post("/rpc", async (c) => {
		let id = "unknown";
		try {
			if (getBearerToken(c.req.header("authorization")) !== options.token) {
				throw new ActionRpcError("UNAUTHORIZED", "Invalid action RPC token");
			}
			const request = parseLocalRpcRequest(await c.req.json());
			id = request.id;
			const result = await dispatch(runtime, request, c.req.raw.signal);
			return c.json({ id, ok: true, result } satisfies ActionRpcResponse);
		} catch (err) {
			return c.json({ id, ok: false, error: errorBody(err) } satisfies ActionRpcResponse, 400);
		}
	});

	const { server, port } = await new Promise<{ server: Server; port: number }>((resolve) => {
		const server = serve(
			{
				fetch: app.fetch,
				hostname: host,
				port: options.port ?? 0,
			},
			(info) => {
				resolve({ server, port: info.port });
			},
		) as Server;
	});

	return {
		endpoint: {
			transport: "http",
			url: `http://${host}:${port}`,
			token: options.token,
		},
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		},
	};
}

export async function startActionRpcServer(
	runtime: ActionRpcRuntime,
	options: StartActionRpcServerOptions,
): Promise<ActionRpcServerHandle> {
	return await startLocalRpcServer({ actions: runtime }, options);
}
