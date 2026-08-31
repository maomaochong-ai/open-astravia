import { defineSessionExtensionEndpoint } from "@vetta/runtime-core/session-extensions";
import type {
	AgentConfiguration,
	AgentConfigurationDocument,
	AgentConfigurationFailureCode,
	AgentConfigurationSelection,
} from "./configuration-schema.js";

export interface AgentConfigurationStatus {
	readonly desired: AgentConfigurationDocument;
	readonly resolved: AgentConfiguration;
	readonly effectiveRevision: number | null;
	readonly pending: boolean;
	readonly failure: { readonly code: AgentConfigurationFailureCode; readonly revision: number } | null;
}

export interface AgentConfigurationResourceCatalog {
	readonly skills: readonly string[];
	readonly tools: readonly string[];
	readonly mcpServers: readonly string[];
	readonly plugins: readonly string[];
	readonly models: readonly { readonly key: string; readonly name: string }[];
}

export interface AgentConfigurationUpdate {
	readonly expectedRevision: number;
	readonly selection: AgentConfigurationSelection;
}

export const AGENT_CONFIGURATION_EXTENSION_ID = "coding-agent.configuration";
export const AGENT_CONFIGURATION_READ = defineSessionExtensionEndpoint<undefined, AgentConfigurationStatus>(
	AGENT_CONFIGURATION_EXTENSION_ID,
	"read",
);
export const AGENT_CONFIGURATION_UPDATE = defineSessionExtensionEndpoint<
	AgentConfigurationUpdate,
	AgentConfigurationStatus
>(AGENT_CONFIGURATION_EXTENSION_ID, "update");
export const AGENT_CONFIGURATION_CATALOG = defineSessionExtensionEndpoint<undefined, AgentConfigurationResourceCatalog>(
	AGENT_CONFIGURATION_EXTENSION_ID,
	"catalog",
);
