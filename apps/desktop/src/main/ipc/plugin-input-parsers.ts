import { PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES, type PluginCodingAgentHookEventName } from "@vetta-org/plugin-sdk";
import type {
	PluginAppActionApproval,
	PluginAppActionRegistration,
	PluginInstallOptions,
	PluginPermission,
} from "../../preload/api-types/plugins.js";
import { parsePluginInstallOptions } from "../plugins/plugin-install-options.js";

export function asArchiveBuffer(value: unknown): ArrayBuffer | Buffer {
	if (value instanceof ArrayBuffer || Buffer.isBuffer(value)) return value;
	throw new Error("Invalid plugin archive buffer");
}

export function asOptions(value: unknown): PluginInstallOptions | undefined {
	return parsePluginInstallOptions(value);
}

export function asPluginId(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("Invalid plugin id");
	}
	return value.trim();
}

export function asRequiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid ${fieldName}`);
	}
	return value.trim();
}

export function asOptionalStringId(value: unknown, fieldName: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid ${fieldName}`);
	}
	return value.trim();
}

export function asPermissions(value: unknown): PluginPermission[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error("Invalid plugin permissions");
	}
	return value as PluginPermission[];
}

export function asCommandNames(value: unknown): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
		throw new Error("Invalid plugin command names");
	}
	return value as string[];
}

export function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Invalid ${fieldName}`);
	}
	return value as Record<string, unknown>;
}

export function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function asOptionalStringArray(value: unknown): string[] | undefined {
	if (value == null) return undefined;
	if (!Array.isArray(value)) return undefined;
	const out = value.filter((v): v is string => typeof v === "string" && v.length > 0);
	return out.length > 0 ? out : [];
}

export function asStrictOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
		throw new Error(`Invalid ${fieldName}`);
	}
	return value.map((item) => item.trim());
}

export function asHandlerContext(value: unknown): { conversation?: "summary" | "messages" } | undefined {
	if (value === undefined) return undefined;
	const input = asRecord(value, "handler context");
	return { conversation: input.conversation === "messages" ? "messages" : "summary" };
}

export function asAgentToolRegistration(value: unknown): {
	id: string;
	name: string;
	label?: string;
	description: string;
	parameters: Record<string, unknown>;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	scope_use?: string[];
	requires?: string[];
	side_effect?: string;
	context?: { conversation?: "summary" | "messages" };
	rendersCard?: boolean;
} {
	const input = asRecord(value, "agent tool registration");
	const id = asPluginId(input.id);
	const name = asPluginId(input.name ?? id);
	const description = asOptionalString(input.description);
	const handlerId = asPluginId(input.handlerId);
	const activationId = asOptionalStringId(input.activationId, "agent tool activation id");
	if (!description) throw new Error("Invalid agent tool description");
	const parameters = asRecord(input.parameters, "agent tool parameters");
	const timeoutMs =
		typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
			? Math.min(Math.floor(input.timeoutMs), 300_000)
			: undefined;
	return {
		id,
		name,
		label: asOptionalString(input.label),
		description,
		parameters,
		handlerId,
		activationId,
		timeoutMs,
		scope_use: asOptionalStringArray(input.scope_use),
		requires: asOptionalStringArray(input.requires),
		// agent_mode 容忍传入但不再解析（ADR-0071）：模式不影响工具的可用性与顺序。
		// side_effect 只收窄合法值；无效/缺省交给 coding-agent 侧 resolver 按 light + 兜底清单处理。
		side_effect: input.side_effect === "heavy" || input.side_effect === "light" ? input.side_effect : undefined,
		context: asHandlerContext(input.context),
		// 渲染进程在注册时探测该工具有没有 tool-call slot；有则宿主注入 md_intro 参数。
		rendersCard: input.rendersCard === true ? true : undefined,
	};
}

export function asAgentHookRegistration(value: unknown): {
	id: string;
	eventName: PluginCodingAgentHookEventName;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	scope_use: string[];
	toolNames?: string[];
} {
	const input = asRecord(value, "agent hook registration");
	if (!PLUGIN_CODING_AGENT_HOOK_EVENT_NAMES.some((eventName) => eventName === input.eventName)) {
		throw new Error("Invalid Coding Agent Hook eventName");
	}
	const scopeUse = asStrictOptionalStringArray(input.scope_use, "agent hook scope_use");
	if (!scopeUse?.length) throw new Error("Agent hook scope_use must not be empty");
	return {
		id: asPluginId(input.id),
		eventName: input.eventName as PluginCodingAgentHookEventName,
		handlerId: asPluginId(input.handlerId),
		activationId: asOptionalStringId(input.activationId, "agent hook activation id"),
		timeoutMs:
			typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
				? Math.min(Math.floor(input.timeoutMs), 30_000)
				: undefined,
		scope_use: scopeUse,
		toolNames: asStrictOptionalStringArray(input.toolNames, "agent hook toolNames"),
	};
}

export function asAppActionApproval(value: unknown): PluginAppActionApproval | undefined {
	if (value === undefined) return undefined;
	const input = asRecord(value, "app action approval");
	const defaultPresentation = asOptionalString(input.defaultPresentation);
	if (!defaultPresentation || !Array.isArray(input.presentations)) {
		throw new Error("Invalid app action approval metadata");
	}
	const presentations = input.presentations.map((value) => {
		const presentation = asRecord(value, "app action approval presentation");
		const id = asOptionalString(presentation.id);
		const title = asOptionalString(presentation.title);
		const description = asOptionalString(presentation.description);
		if (!id || !title || !description) throw new Error("Invalid app action approval presentation");
		return { id, title, description };
	});
	const operationInput =
		input.presentationByOperation === undefined
			? undefined
			: asRecord(input.presentationByOperation, "app action approval operation map");
	const presentationByOperation = operationInput
		? Object.fromEntries(
				Object.entries(operationInput).map(([operation, presentation]) => {
					if (typeof presentation !== "string" || presentation.trim().length === 0) {
						throw new Error("Invalid app action approval operation presentation");
					}
					return [operation, presentation.trim()];
				}),
			)
		: undefined;
	const alternativesInput =
		input.alternativePresentationsByOperation === undefined
			? undefined
			: asRecord(input.alternativePresentationsByOperation, "app action approval alternative map");
	const alternativePresentationsByOperation = alternativesInput
		? Object.fromEntries(
				Object.entries(alternativesInput).map(([operation, alternatives]) => {
					if (
						!Array.isArray(alternatives) ||
						alternatives.some((presentation) => typeof presentation !== "string" || !presentation.trim())
					) {
						throw new Error("Invalid app action alternative approval presentations");
					}
					return [operation, alternatives.map((presentation) => presentation.trim())];
				}),
			)
		: undefined;
	return {
		defaultPresentation,
		presentations,
		presentationByOperation,
		alternativePresentationsByOperation,
	};
}

export function asAppActionRegistration(value: unknown): PluginAppActionRegistration {
	const input = asRecord(value, "app action registration");
	const id = asPluginId(input.id);
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
		throw new Error("Invalid app action id");
	}
	const title = asOptionalString(input.title);
	const summary = asOptionalString(input.summary);
	const publicId = asOptionalString(input.publicId);
	if (publicId && !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(publicId)) {
		throw new Error("Invalid app action public id");
	}
	const handlerId = asPluginId(input.handlerId);
	const activationId = asPluginId(input.activationId);
	if (!title) throw new Error("Invalid app action title");
	if (!summary) throw new Error("Invalid app action summary");
	if (input.effect !== "read" && input.effect !== "write" && input.effect !== "execute") {
		throw new Error("Invalid app action effect");
	}
	const examples = input.examples === undefined ? [] : input.examples;
	if (!Array.isArray(examples)) throw new Error("Invalid app action examples");
	return {
		id,
		publicId,
		title,
		summary,
		description: asOptionalString(input.description),
		keywords: asOptionalStringArray(input.keywords),
		effect: input.effect,
		approval: asAppActionApproval(input.approval),
		inputSchema: asRecord(input.inputSchema, "app action input schema"),
		examples: examples.map((example) => {
			const normalized = asRecord(example, "app action example");
			const description = asOptionalString(normalized.description);
			if (!description) throw new Error("Invalid app action example description");
			return { description, input: normalized.input };
		}),
		handlerId,
		activationId,
		hasAssertReady: input.hasAssertReady === true,
		timeoutMs:
			typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
				? Math.min(Math.floor(input.timeoutMs), 120_000)
				: undefined,
	};
}

export function asContinuationRegistration(value: unknown): {
	id: string;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	context?: { conversation?: "summary" | "messages" };
} {
	const input = asRecord(value, "continuation registration");
	return {
		id: asPluginId(input.id),
		handlerId: asPluginId(input.handlerId),
		activationId: asOptionalStringId(input.activationId, "continuation activation id"),
		timeoutMs:
			typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
				? Math.min(Math.floor(input.timeoutMs), 30_000)
				: undefined,
		context: asHandlerContext(input.context),
	};
}

export function asSystemPromptProviderRegistration(value: unknown): {
	id: string;
	handlerId: string;
	activationId?: string;
	timeoutMs?: number;
	context?: {
		systemPrompt?: "none" | "blocks" | "rendered" | "full";
		conversation?: "summary" | "messages";
	};
} {
	const input = asRecord(value, "system prompt provider registration");
	const contextInput =
		input.context === undefined ? undefined : asRecord(input.context, "system prompt provider context");
	const systemPrompt =
		contextInput?.systemPrompt === "blocks" ||
		contextInput?.systemPrompt === "rendered" ||
		contextInput?.systemPrompt === "full"
			? contextInput.systemPrompt
			: "none";
	const conversation = contextInput?.conversation === "messages" ? "messages" : "summary";
	return {
		id: asPluginId(input.id),
		handlerId: asPluginId(input.handlerId),
		activationId: asOptionalStringId(input.activationId, "system prompt provider activation id"),
		timeoutMs:
			typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
				? Math.min(Math.floor(input.timeoutMs), 30_000)
				: undefined,
		context: contextInput ? { systemPrompt, conversation } : undefined,
	};
}
