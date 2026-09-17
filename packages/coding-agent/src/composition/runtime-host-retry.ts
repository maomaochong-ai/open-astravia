import {
	ConfigurableRuntimeTurnRetryPolicy,
	DeferredRuntimeRetryEventStream,
	NoRetryPolicy,
	type RuntimeHostSessionAssembly,
	type RuntimeObservationPublisher,
	type RuntimeSession,
	type RuntimeTurnRetryPolicy,
	runtimeError,
	withRuntimeHostSessionRetry,
} from "@vetta/runtime-core";
import {
	CONVERSATION_STORAGE_ERROR_CODES,
	ConversationOwnershipConflictError,
	ConversationStorageError,
} from "@vetta/runtime-storage";
import { readCodingAgentTurnFailure } from "../execution/turn/turn-executor.js";
import type { CodingAgentRuntimeHostRetrySettings } from "./contracts/index.js";

/** Coding Agent failure projection for the generic Runtime assembly retry decorator. */
export function withCodingAgentRuntimeHostRetry(
	session: RuntimeSession,
	assembly: RuntimeHostSessionAssembly,
	settings: CodingAgentRuntimeHostRetrySettings,
	observationPublisher?: RuntimeObservationPublisher,
	automaticRetry = true,
): RuntimeHostSessionAssembly {
	return withRuntimeHostSessionRetry(session, assembly, {
		policy: createCodingAgentRuntimeHostRetryPolicy(settings, automaticRetry),
		readFailure: readCodingAgentTurnFailure,
		observationPublisher,
	});
}

export function createCodingAgentRuntimeHostRetryPolicy(
	settings: CodingAgentRuntimeHostRetrySettings,
	automaticRetry = true,
): RuntimeTurnRetryPolicy {
	if (!automaticRetry) return new NoRetryPolicy();
	return new ConfigurableRuntimeTurnRetryPolicy({
		readSettings: () => settings.getRetrySettings(),
		setEnabled: (enabled) => settings.setRetryEnabled(enabled),
	});
}

export function mapCodingAgentRuntimeSessionCreationError(error: unknown): unknown {
	if (
		error instanceof ConversationStorageError &&
		error.code === CONVERSATION_STORAGE_ERROR_CODES.OWNERSHIP_CONFLICT
	) {
		const holder = error instanceof ConversationOwnershipConflictError ? error.holder : undefined;
		const details = holder
			? {
					lockHolder: {
						pid: holder.pid,
						hostname: holder.hostname,
						openedAt: holder.acquiredAt,
					},
				}
			: undefined;
		return runtimeError("SESSION_LOCKED", error.message, false, "runtime", details);
	}
	return error;
}

/** @deprecated Runtime Core owns this event-order mechanism. */
export { DeferredRuntimeRetryEventStream as DeferredRuntimeErrorEventStream };
