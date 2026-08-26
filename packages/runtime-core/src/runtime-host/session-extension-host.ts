import type { RuntimeEventSource } from "../contracts.js";
import type { SessionExtensionEndpointHost, SessionExtensionObservation } from "../session-extensions/contracts.js";
import type { RuntimeSessionExtensionHost } from "./session-ports.js";

export interface RuntimeSessionExtensionSource {
	readonly endpoints: SessionExtensionEndpointHost;
	readInitialObservations(): readonly SessionExtensionObservation[];
}

/** Adapts generic Session Extension contributions to the RuntimeHost event-source contract. */
export function createRuntimeSessionExtensionHost(
	source: RuntimeSessionExtensionSource,
	eventSource: RuntimeEventSource = "agent",
): RuntimeSessionExtensionHost {
	return {
		hasEndpoint: (token) => source.endpoints.hasEndpoint(token),
		invoke: (token, input, signal) => source.endpoints.invoke(token, input, signal),
		invokeSync: (token, input, signal) => source.endpoints.invokeSync(token, input, signal),
		readInitialObservations: () =>
			source.readInitialObservations().map((observation) => ({ ...observation, source: eventSource })),
	};
}
