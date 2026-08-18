import type { AgentPluginRuntimeEffect, AgentPluginSystemPromptInvocation } from "@vetta/runtime-core";
import type {
	InstalledPlugin,
	PluginDynamicSystemPromptOperation,
	PluginPermission,
	SystemPromptBlockInput,
} from "../../preload/api-types/plugins.js";

function hasGrantedPermission(plugin: InstalledPlugin, permission: PluginPermission): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Invalid dynamic system prompt ${fieldName}`);
	}
	return value as Record<string, unknown>;
}

function asString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid dynamic system prompt ${fieldName}`);
	}
	return value;
}

function asOptionalNumber(value: unknown, fieldName: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Invalid dynamic system prompt ${fieldName}`);
	}
	return value;
}

function asOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`Invalid dynamic system prompt ${fieldName}`);
	return value;
}

function assertBlockAccess(plugin: InstalledPlugin, blockId: string): void {
	if (blockId.startsWith(`plugin.${plugin.id}.`) || hasGrantedPermission(plugin, "agent.systemPrompt.fullControl")) {
		return;
	}
	throw new Error(`Plugin ${plugin.id} cannot modify system prompt block ${blockId}`);
}

function parseBlock(value: unknown, requireId: boolean): SystemPromptBlockInput {
	const block = asRecord(value, "block");
	return {
		id: requireId ? asString(block.id, "block.id") : typeof block.id === "string" ? block.id : "",
		content: asString(block.content, "block.content"),
		priority: asOptionalNumber(block.priority, "block.priority"),
		enabled: asOptionalBoolean(block.enabled, "block.enabled"),
	};
}

function parseOperation(value: unknown): PluginDynamicSystemPromptOperation {
	const operation = asRecord(value, "operation");
	const type = asString(operation.type, "operation.type");
	if (type === "addBlock") return { type, block: parseBlock(operation.block, true) };
	if (type === "setToolEnabled") {
		const enabled = asOptionalBoolean(operation.enabled, "operation.enabled");
		if (enabled === undefined) throw new Error("Invalid dynamic system prompt operation.enabled");
		return { type, toolName: asString(operation.toolName, "operation.toolName"), enabled };
	}
	if (type === "requestContinuation") {
		const result = asRecord(operation.result, "operation.result");
		return {
			type,
			result: {
				text: asString(result.text, "operation.result.text"),
				idempotencyKey:
					result.idempotencyKey === undefined
						? undefined
						: asString(result.idempotencyKey, "operation.result.idempotencyKey"),
			},
		};
	}
	const blockId = asString(operation.blockId, "operation.blockId");
	if (type === "replaceBlock") {
		const block = parseBlock(operation.block, false);
		return { type, blockId, block: { content: block.content, priority: block.priority, enabled: block.enabled } };
	}
	if (type === "updateBlock") {
		const patch = asRecord(operation.patch, "operation.patch");
		return {
			type,
			blockId,
			patch: {
				...(patch.content === undefined ? {} : { content: asString(patch.content, "operation.patch.content") }),
				...(patch.priority === undefined
					? {}
					: { priority: asOptionalNumber(patch.priority, "operation.patch.priority") }),
				...(patch.enabled === undefined
					? {}
					: { enabled: asOptionalBoolean(patch.enabled, "operation.patch.enabled") }),
			},
		};
	}
	if (type === "removeBlock") return { type, blockId };
	if (type === "setBlockEnabled") {
		const enabled = asOptionalBoolean(operation.enabled, "operation.enabled");
		if (enabled === undefined) throw new Error("Invalid dynamic system prompt operation.enabled");
		return { type, blockId, enabled };
	}
	throw new Error(`Unsupported dynamic system prompt operation: ${type}`);
}

export function normalizeDynamicSystemPromptOperations(
	plugin: InstalledPlugin,
	value: unknown,
): AgentPluginRuntimeEffect[] {
	if (!Array.isArray(value)) throw new Error("Invalid dynamic system prompt result");
	return value.map(parseOperation).map((operation): AgentPluginRuntimeEffect => {
		if (operation.type === "setToolEnabled") {
			if (!hasGrantedPermission(plugin, "agent.tools.control")) {
				throw new Error(`Plugin ${plugin.id} cannot change runtime tool availability`);
			}
			return operation;
		}
		if (operation.type === "requestContinuation") {
			if (!hasGrantedPermission(plugin, "agent.continuation.register")) {
				throw new Error(`Plugin ${plugin.id} cannot request Agent continuation`);
			}
			return operation;
		}
		if (operation.type === "addBlock") {
			assertBlockAccess(plugin, operation.block.id);
			return {
				type: "addBlock",
				block: {
					...operation.block,
					type: "plugin",
					source: { kind: "plugin", pluginId: plugin.id },
					priority: operation.block.priority ?? 850,
					enabled: operation.block.enabled ?? true,
				},
			};
		}
		assertBlockAccess(plugin, operation.blockId);
		if (operation.type === "replaceBlock") {
			return {
				type: "replaceBlock",
				blockId: operation.blockId,
				block: {
					id: operation.blockId,
					type: "plugin",
					source: { kind: "plugin", pluginId: plugin.id },
					content: operation.block.content,
					priority: operation.block.priority ?? 850,
					enabled: operation.block.enabled ?? true,
				},
			};
		}
		return operation;
	});
}

export function filterSystemPromptInvocationForPlugin(
	plugin: InstalledPlugin,
	invocation: AgentPluginSystemPromptInvocation,
): AgentPluginSystemPromptInvocation {
	if (!invocation.systemPrompt || hasGrantedPermission(plugin, "agent.systemPrompt.fullControl")) {
		return invocation;
	}
	const filterSnapshot = (
		snapshot: NonNullable<AgentPluginSystemPromptInvocation["systemPrompt"]>["base"],
	): NonNullable<AgentPluginSystemPromptInvocation["systemPrompt"]>["base"] => ({
		...snapshot,
		rendered: undefined,
		blocks: snapshot.blocks?.map((block) =>
			block.source.pluginId === plugin.id ? block : { ...block, content: "" },
		),
	});
	return {
		...invocation,
		systemPrompt: {
			base: filterSnapshot(invocation.systemPrompt.base),
			current: filterSnapshot(invocation.systemPrompt.current),
		},
	};
}
