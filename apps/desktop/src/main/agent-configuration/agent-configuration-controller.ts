import {
	AgentConfigurationError,
	parseAgentConfiguration,
	parseAgentConfigurationSelection,
} from "@vetta/coding-agent/profile";
import {
	AGENT_CONFIGURATION_CATALOG,
	AGENT_CONFIGURATION_READ,
	AGENT_CONFIGURATION_UPDATE,
} from "@vetta/coding-agent/session-extensions";
import type { RuntimeHost } from "@vetta/runtime-core";
import type { AgentTemplateRepository } from "./template-repository.js";

interface ConfigurationLogger {
	info(message: string, fields: Record<string, unknown>): void;
	warn(message: string, fields: Record<string, unknown>): void;
}

/** Validates transport input and delegates state to its owning repository or Session extension. */
export class DesktopAgentConfigurationController {
	constructor(
		private readonly templates: AgentTemplateRepository,
		private readonly runtime: () => RuntimeHost,
		private readonly logger: ConfigurationLogger,
	) {}

	listTemplates() {
		return this.templates.list();
	}

	async saveTemplate(value: unknown) {
		const input = requireObject(value);
		const template = await this.templates.save({
			...(input.id === undefined ? {} : { id: requireId(input.id) }),
			expectedRevision: requireRevision(input.expectedRevision),
			name: requireId(input.name),
			configuration: parseAgentConfiguration(input.configuration),
		});
		this.logger.info("agent template saved", { templateId: template.id, revision: template.revision });
		return template;
	}

	async deleteTemplate(id: unknown, revision: unknown): Promise<void> {
		const templateId = requireId(id);
		await this.templates.delete(templateId, requireRevision(revision));
		this.logger.info("agent template deleted", { templateId });
	}

	readSession(sessionId: unknown) {
		return this.runtime().invokeSessionExtension(requireId(sessionId), AGENT_CONFIGURATION_READ, undefined);
	}
	readCatalog(sessionId: unknown) {
		return this.runtime().invokeSessionExtension(requireId(sessionId), AGENT_CONFIGURATION_CATALOG, undefined);
	}

	async updateSession(sessionId: unknown, value: unknown) {
		const id = requireId(sessionId);
		const input = requireObject(value);
		try {
			const status = await this.runtime().invokeSessionExtension(id, AGENT_CONFIGURATION_UPDATE, {
				expectedRevision: requireRevision(input.expectedRevision),
				selection: parseAgentConfigurationSelection(input.selection),
			});
			this.logger.info("agent session configuration saved", {
				sessionId: id,
				revision: status.desired.revision,
				pending: status.pending,
			});
			return status;
		} catch (error) {
			this.logger.warn("agent session configuration save failed", {
				sessionId: id,
				code: error instanceof AgentConfigurationError ? error.code : "AGENT_CONFIGURATION_APPLY_FAILED",
			});
			throw error;
		}
	}
}

function requireObject(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
	return value as Record<string, unknown>;
}
function requireId(value: unknown): string {
	if (typeof value !== "string" || !value.trim() || value.length > 256)
		throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
	return value;
}
function requireRevision(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
	return value;
}
