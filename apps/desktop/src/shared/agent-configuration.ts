import type { AgentConfiguration, AgentConfigurationTemplate } from "@vetta/coding-agent/profile";
import type {
	AgentConfigurationResourceCatalog,
	AgentConfigurationStatus,
	AgentConfigurationUpdate,
} from "@vetta/coding-agent/session-extensions";

export interface AgentTemplateSaveRequest {
	readonly id?: string;
	readonly expectedRevision: number;
	readonly name: string;
	readonly configuration: AgentConfiguration;
}

export interface DesktopAgentConfigurationApi {
	listTemplates(): Promise<readonly AgentConfigurationTemplate[]>;
	saveTemplate(request: AgentTemplateSaveRequest): Promise<AgentConfigurationTemplate>;
	deleteTemplate(id: string, expectedRevision: number): Promise<void>;
	readSession(sessionId: string): Promise<AgentConfigurationStatus>;
	updateSession(sessionId: string, request: AgentConfigurationUpdate): Promise<AgentConfigurationStatus>;
	readCatalog(sessionId: string): Promise<AgentConfigurationResourceCatalog>;
}

export const AGENT_CONFIGURATION_CHANNELS = {
	LIST: "agent-configuration:list-templates",
	SAVE: "agent-configuration:save-template",
	DELETE: "agent-configuration:delete-template",
	READ_SESSION: "agent-configuration:read-session",
	UPDATE_SESSION: "agent-configuration:update-session",
	CATALOG: "agent-configuration:catalog",
} as const;
