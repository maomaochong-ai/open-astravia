import {
	ConfigurableRuntimeTurnRetryPolicy,
	DeferredRuntimeRetryEventStream,
	type RuntimeHostSessionAssembly,
	type RuntimeObservationPublisher,
	type RuntimeSession,
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
): RuntimeHostSessionAssembly {
	return withRuntimeHostSessionRetry(session, assembly, {
		policy: new ConfigurableRuntimeTurnRetryPolicy({
			readSettings: () => settings.getRetrySettings(),
			setEnabled: (enabled) => settings.setRetryEnabled(enabled),
		}),
		readFailure: readCodingAgentTurnFailure,
		observationPublisher,
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
