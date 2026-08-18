import { ActionRpcError, type ActionRpcRuntime } from "@vetta/action-rpc";
import { getAppLogger } from "../logger.js";
import type { AppActionRuntime } from "./runtime.js";
import { ActionError, type JsonValue } from "./types.js";

const log = getAppLogger("action-rpc");

async function toActionRpcResult<T>(operation: () => Promise<T> | T): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof ActionError) {
			throw new ActionRpcError(error.code, error.message, error.details);
		}
		log.error("action RPC failed", error);
		throw error;
	}
}

export function createActionRpcRuntime(runtime: AppActionRuntime): ActionRpcRuntime {
	return {
		search: (options) => toActionRpcResult(() => runtime.search(options)),
		describe: (actionId) => toActionRpcResult(() => runtime.describe(actionId)),
		run: async (actionId, input, context): Promise<JsonValue> =>
			await toActionRpcResult(() =>
				runtime.run(actionId, input ?? {}, {
					source: "local-server",
					requestId: context.requestId,
					signal: context.signal,
				}),
			),
	};
}
