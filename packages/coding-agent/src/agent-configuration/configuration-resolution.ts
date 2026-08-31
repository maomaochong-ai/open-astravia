import type { RuntimeConfigurationSnapshotLease } from "@vetta/runtime-core/configuration";
import { RuntimeConfigurationRegistry, RuntimeConfigurationResolver } from "@vetta/runtime-core/configuration";
import {
	AGENT_CONFIGURATION_DEFINITION,
	type AgentConfigurationDocument,
	AgentConfigurationError,
	parseAgentConfiguration,
} from "./configuration-schema.js";

/** Product layers use the shared Runtime resolver, including its codec and revision leases. */
export class AgentConfigurationResolution {
	private readonly registry = new RuntimeConfigurationRegistry();
	private readonly resolver = new RuntimeConfigurationResolver(this.registry);

	constructor() {
		this.registry.upsert({
			source: { id: "coding-agent", revision: "1" },
			definition: AGENT_CONFIGURATION_DEFINITION,
		});
	}

	async resolve(document: AgentConfigurationDocument) {
		const { template, overrides } = document.selection;
		const id = AGENT_CONFIGURATION_DEFINITION.id;
		const lease: RuntimeConfigurationSnapshotLease = this.resolver.capture([
			...(template
				? [
						{
							id: "template",
							revision: `${template.id}@${template.revision}`,
							precedence: 10,
							values: { [id]: template.configuration },
						},
					]
				: []),
			{ id: "session", revision: String(document.revision), precedence: 20, values: { [id]: overrides } },
		]);
		try {
			if (lease.snapshot.diagnostics.length > 0) throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
			return parseAgentConfiguration(lease.snapshot.entries.find((entry) => entry.configurationId === id)?.value);
		} finally {
			await lease.release();
		}
	}

	close(): Promise<void> {
		return this.registry.close();
	}
}
