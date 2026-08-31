import type { RuntimeObservationPublisher } from "@vetta/runtime-core/observation";
import type { SessionExtensionDefinition } from "@vetta/runtime-core/session-extensions";
import { defineSessionExtensionService } from "@vetta/runtime-core/session-extensions";
import type { AgentConfigurationSelection } from "./configuration-schema.js";
import { AgentSessionConfiguration } from "./session-configuration.js";
import {
	AGENT_CONFIGURATION_CATALOG,
	AGENT_CONFIGURATION_EXTENSION_ID,
	AGENT_CONFIGURATION_READ,
	AGENT_CONFIGURATION_UPDATE,
} from "./session-configuration-contract.js";

export const AGENT_SESSION_CONFIGURATION = defineSessionExtensionService<AgentSessionConfiguration>(
	AGENT_CONFIGURATION_EXTENSION_ID,
	"runtime",
);

export function createAgentConfigurationSessionExtension(
	initial?: AgentConfigurationSelection,
	observations?: RuntimeObservationPublisher,
): SessionExtensionDefinition {
	return {
		id: AGENT_CONFIGURATION_EXTENSION_ID,
		async create(context) {
			const runtime = new AgentSessionConfiguration(
				initial,
				context.createId,
				() => context.clock.now(),
				observations,
			);
			try {
				await runtime.prepare();
				return {
					contributions: [
						{ kind: "service", token: AGENT_SESSION_CONFIGURATION, value: runtime },
						{ kind: "endpoint", token: AGENT_CONFIGURATION_READ, handle: () => runtime.read() },
						{ kind: "endpoint", token: AGENT_CONFIGURATION_UPDATE, handle: (input) => runtime.update(input) },
						{ kind: "endpoint", token: AGENT_CONFIGURATION_CATALOG, handle: () => runtime.readCatalog() },
						{
							kind: "document-participant",
							participant: {
								initialize: (document, context) => runtime.initialize(document, context),
								onDocumentChanged: (document) => runtime.onDocumentChanged(document),
								onSessionEvent: (event) => runtime.onSessionEvent(event),
							},
						},
					],
					dispose: () => runtime.dispose(),
				};
			} catch (error) {
				await runtime.dispose();
				throw error;
			}
		},
	};
}
