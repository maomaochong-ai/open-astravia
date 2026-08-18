import { ActionRpcError, type DebugRpcRuntime } from "@vetta/action-rpc";
import { getAppLogger } from "../logger.js";
import type { AppDebugRuntime } from "./runtime.js";
import { DebugError, type JsonValue } from "./types.js";

const log = getAppLogger("debug-rpc");

async function toDebugRpcResult<T>(operation: () => Promise<T> | T): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof DebugError) {
			throw new ActionRpcError(error.code, error.message, error.details);
		}
		log.error("debug RPC failed", error);
		throw error;
	}
}

export function createDebugRpcRuntime(runtime: AppDebugRuntime): DebugRpcRuntime {
	return {
		search: (options) => toDebugRpcResult(() => runtime.search(options)),
		describe: (debugId) => toDebugRpcResult(() => runtime.describe(debugId)),
		run: async (debugId, input, context): Promise<JsonValue> =>
			await toDebugRpcResult(() =>
				runtime.run(debugId, input ?? {}, {
					source: "local-server",
					requestId: context.requestId,
					signal: context.signal,
				}),
			),
	};
}
