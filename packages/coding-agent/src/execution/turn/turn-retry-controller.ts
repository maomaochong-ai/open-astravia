import { ConfigurableRuntimeTurnRetryPolicy, RuntimeTurnRetryCoordinator } from "@vetta/runtime-core";
import type { CodingAgentTurnRetryController, CodingAgentTurnRetryControllerOptions } from "./contracts.js";

/** @deprecated Use RuntimeTurnRetryCoordinator for new integrations. */
export class CodingAgentSessionTurnRetryController extends RuntimeTurnRetryCoordinator {
	constructor(options: CodingAgentTurnRetryControllerOptions) {
		super({
			policy: new ConfigurableRuntimeTurnRetryPolicy({
				readSettings: options.readSettings,
				setEnabled: options.setEnabled,
			}),
			emit: options.emit,
			observationPublisher: options.observationPublisher,
			observationContext: options.observationContext,
		});
	}
}

export function createCodingAgentTurnRetryController(
	options: CodingAgentTurnRetryControllerOptions,
): CodingAgentTurnRetryController {
	return new CodingAgentSessionTurnRetryController(options);
}
