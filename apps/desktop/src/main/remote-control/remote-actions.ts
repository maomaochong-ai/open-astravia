import { REMOTE_MAX_ACTION_RESULT_CHARS } from "@vetta/remote-control";
import type { ActionContext, ActionDefinition, JsonValue } from "../app-actions/types.js";
import { ActionError } from "../app-actions/types.js";
import { RemoteOperationError } from "./remote-error-mapping.js";

/** The slice of the App Action system `action.run` needs; main.ts passes the real catalog and runtime. */
export interface RemoteActionHost {
	get(actionId: string): ActionDefinition;
	run(actionId: string, input: unknown, context: ActionContext): Promise<JsonValue>;
}

/**
 * `action.run` from a paired phone. Only actions a plugin registered with `remote: true` qualify,
 * and those are read-only by construction (`PluginActionService` refuses anything else), so the
 * phone never reaches an action that asks for approval or changes anything.
 */
export async function runRemoteAction(host: RemoteActionHost, payload: unknown): Promise<{ result: JsonValue }> {
	const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : {};
	const actionId = (record as { actionId?: unknown }).actionId;
	if (typeof actionId !== "string" || !actionId)
		throw new RemoteOperationError("invalid_frame", "actionId is required");
	const input = (record as { input?: unknown }).input ?? {};
	let action: ActionDefinition;
	try {
		action = host.get(actionId);
	} catch (error) {
		throw toRemoteActionError(error);
	}
	// Indistinguishable from a missing action, so a phone cannot probe what else is installed.
	if (action.remote !== true || action.requiresApproval) {
		throw new RemoteOperationError("not_found", "Action is not offered to phones");
	}
	let result: JsonValue;
	try {
		result = await host.run(actionId, input, { source: "remote-control" });
	} catch (error) {
		throw toRemoteActionError(error);
	}
	if (JSON.stringify(result ?? null).length > REMOTE_MAX_ACTION_RESULT_CHARS) {
		throw new RemoteOperationError("too_large", "Action result is too large to send");
	}
	return { result };
}

function toRemoteActionError(error: unknown): RemoteOperationError {
	if (error instanceof RemoteOperationError) return error;
	if (error instanceof ActionError) {
		switch (error.code) {
			case "ACTION_NOT_FOUND":
				return new RemoteOperationError("not_found", "Action is not offered to phones");
			case "ACTION_INVALID_INPUT":
				return new RemoteOperationError("invalid_frame", "Action input does not match its schema");
			case "ACTION_RUNTIME_NOT_READY":
			case "PLUGIN_ACTION_UNAVAILABLE":
				return new RemoteOperationError("busy", "The plugin is not ready on the desktop", true);
			case "PLUGIN_ACTION_TIMEOUT":
				return new RemoteOperationError("request_timeout", "The plugin action timed out", true);
			default:
				// Plugin-thrown codes stay out of the message: it may carry plugin internals.
				return new RemoteOperationError("internal_error", "The plugin action failed");
		}
	}
	return new RemoteOperationError("internal_error", "The plugin action failed");
}
