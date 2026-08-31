import { readFile, stat } from "node:fs/promises";
import {
	AgentConfigurationError,
	type AgentConfigurationTemplate,
	parseAgentConfigurationTemplate,
} from "@vetta/coding-agent/profile";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import type { AgentTemplateSaveRequest } from "../../shared/agent-configuration.js";

const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
const MAX_TEMPLATES = 128;

interface AgentTemplateDocument {
	readonly schemaVersion: 1;
	readonly templates: readonly AgentConfigurationTemplate[];
}

/** One app-owned file and serialized CAS updates; never overwrite unreadable or future documents. */
export class AgentTemplateRepository {
	private tail: Promise<void> = Promise.resolve();

	constructor(
		private readonly path: string,
		private readonly maxDocumentBytes = MAX_DOCUMENT_BYTES,
	) {}

	async list(): Promise<readonly AgentConfigurationTemplate[]> {
		await this.tail;
		return (await this.read()).templates;
	}

	save(request: AgentTemplateSaveRequest): Promise<AgentConfigurationTemplate> {
		return this.mutate(async (document) => {
			const existing = request.id === undefined ? undefined : document.templates.find(({ id }) => id === request.id);
			if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
			if ((existing?.revision ?? 0) !== request.expectedRevision || (request.id !== undefined && !existing))
				throw new AgentConfigurationError("AGENT_CONFIGURATION_CONFLICT");
			if (!existing && document.templates.length >= MAX_TEMPLATES)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
			const template = parseAgentConfigurationTemplate({
				id: existing?.id ?? crypto.randomUUID(),
				revision: (existing?.revision ?? 0) + 1,
				name: request.name,
				configuration: request.configuration,
			});
			return {
				document: {
					schemaVersion: 1,
					templates: [...document.templates.filter(({ id }) => id !== template.id), template],
				},
				result: template,
			};
		});
	}

	delete(id: string, expectedRevision: number): Promise<void> {
		return this.mutate(async (document) => {
			const template = document.templates.find((item) => item.id === id);
			if (!template || template.revision !== expectedRevision)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_CONFLICT");
			return {
				document: { schemaVersion: 1, templates: document.templates.filter((item) => item.id !== id) },
				result: undefined,
			};
		});
	}

	private mutate<T>(
		change: (document: AgentTemplateDocument) => Promise<{ document: AgentTemplateDocument; result: T }>,
	): Promise<T> {
		const operation = this.tail.then(async () => {
			const updated = await change(await this.read());
			if (Buffer.byteLength(JSON.stringify(updated.document, null, 2), "utf8") > this.maxDocumentBytes)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
			await atomicWriteJSONAsync(this.path, updated.document);
			return updated.result;
		});
		this.tail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private async read(): Promise<AgentTemplateDocument> {
		try {
			if ((await stat(this.path)).size > this.maxDocumentBytes)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
			const content = await readFile(this.path, "utf8");
			if (Buffer.byteLength(content, "utf8") > this.maxDocumentBytes)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
			const value: unknown = JSON.parse(content);
			if (
				!isRecord(value) ||
				value.schemaVersion !== 1 ||
				!Array.isArray(value.templates) ||
				value.templates.length > MAX_TEMPLATES ||
				Object.keys(value).some((key) => key !== "schemaVersion" && key !== "templates")
			)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
			const templates = value.templates.map(parseAgentConfigurationTemplate);
			if (new Set(templates.map(({ id }) => id)).size !== templates.length)
				throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
			return { schemaVersion: 1, templates };
		} catch (error) {
			if (isRecord(error) && error.code === "ENOENT") return { schemaVersion: 1, templates: [] };
			throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
