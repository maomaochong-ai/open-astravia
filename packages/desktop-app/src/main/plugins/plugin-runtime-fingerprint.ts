import { createHash } from "node:crypto";
import type { AgentPluginRuntimeConfig } from "@vetta/runtime-core";

export interface AgentPluginRuntimeFingerprints {
	/** Every runtime-relevant field, including handler and activation identity. */
	runtime: string;
	/** Static topology that can affect prompt or tool materialization. */
	modelTopology: string;
}

export function fingerprintAgentPluginRuntimeConfig(
	config: AgentPluginRuntimeConfig | undefined,
): AgentPluginRuntimeFingerprints {
	return {
		runtime: fingerprint(config),
		modelTopology: fingerprint(projectModelTopology(config)),
	};
}

function projectModelTopology(config: AgentPluginRuntimeConfig | undefined): unknown {
	if (!config) return undefined;
	return {
		systemPromptContributions: config.systemPromptContributions,
		skillPathContributions: config.skillPathContributions,
		toolPolicyContributions: config.toolPolicyContributions,
		toolContributions: config.toolContributions?.map(
			({ handlerId: _handlerId, activationId: _activationId, timeoutMs: _timeoutMs, context: _context, ...tool }) =>
				tool,
		),
		stateContributions: config.stateContributions,
		continuationContributions: config.continuationContributions?.map(
			({
				handlerId: _handlerId,
				activationId: _activationId,
				timeoutMs: _timeoutMs,
				context: _context,
				...provider
			}) => provider,
		),
		systemPromptProviderContributions: config.systemPromptProviderContributions?.map(
			({ handlerId: _handlerId, activationId: _activationId, timeoutMs: _timeoutMs, ...provider }) => provider,
		),
		mcpServerContributions: config.mcpServerContributions,
	};
}

function fingerprint(value: unknown): string {
	return `apr1:${createHash("sha256").update(stableSerialize(value)).digest("hex").slice(0, 16)}`;
}

function stableSerialize(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
	return `{${entries.join(",")}}`;
}
