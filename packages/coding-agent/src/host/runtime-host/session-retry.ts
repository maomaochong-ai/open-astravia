import {
	ConfigurableRuntimeTurnRetryPolicy,
	DeferredRuntimeRetryEventStream,
	type RuntimeHostSessionAssembly,
	type RuntimeObservationPublisher,
	type RuntimeSession,
	withRuntimeHostSessionRetry,
} from "@vetta/runtime-core";
import type { CodingAgentTurnRetrySettings } from "../../execution/turn/contracts.js";
import { readCodingAgentTurnFailure } from "../../execution/turn/turn-executor.js";

export interface CodingAgentRuntimeHostRetrySettings {
	getRetrySettings(): CodingAgentTurnRetrySettings;
	setRetryEnabled(enabled: boolean): void;
}

/** Coding settings/failure adapter for the generic RuntimeHost retry decorator. */
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

/** @deprecated Runtime Core owns this event-order mechanism. */
export { DeferredRuntimeRetryEventStream as DeferredRuntimeErrorEventStream };
