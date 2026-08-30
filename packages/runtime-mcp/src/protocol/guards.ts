import { isMcpCacheableResult } from "./cache.js";
import type { McpDiscoverResult } from "./discovery.js";
import type { McpInputRequests, McpInputRequiredResult, McpRequestMeta } from "./interaction.js";
import { isMcpJsonValue, type McpJsonObject } from "./json.js";
import { MCP_SUBSCRIPTION_ID_META_KEY, type McpSubscriptionsListenResult } from "./subscriptions.js";
import type { McpTask } from "./tasks.js";
import type {
	McpCapabilities,
	McpClientInfo,
	McpContent,
	McpInitializeResult,
	McpPromptGetResult,
	McpPromptsListResult,
	McpResourceContents,
	McpResourceReadResult,
	McpResourcesListResult,
	McpToolCallResult,
	McpToolsListResult,
} from "./types.js";
import type { McpProtocolEra } from "./versions.js";

export interface McpResultGuardOptions {
	readonly era?: McpProtocolEra;
}

/** Runtime validation for untrusted MCP wire results. Unknown extension fields are retained. */
export function isMcpToolCallResult(value: unknown, options?: McpResultGuardOptions): value is McpToolCallResult {
	if (!isRecord(value) || !Array.isArray(value.content) || !value.content.every(isMcpContent)) return false;
	if (!isCompleteResultType(value.resultType, options?.era)) return false;
	return (
		(value.structuredContent === undefined || isMcpJsonValue(value.structuredContent)) &&
		(value.isError === undefined || typeof value.isError === "boolean")
	);
}

export function isMcpInputRequiredResult(value: unknown): value is McpInputRequiredResult {
	if (!isRecord(value) || value.resultType !== "input_required") return false;
	if (value.requestState !== undefined && typeof value.requestState !== "string") return false;
	if (value.inputRequests !== undefined && !isMcpInputRequests(value.inputRequests)) return false;
	return value.requestState !== undefined || value.inputRequests !== undefined;
}

export function isMcpResourceReadResult(
	value: unknown,
	options?: McpResultGuardOptions,
): value is McpResourceReadResult {
	if (!isRecord(value) || !Array.isArray(value.contents) || !value.contents.every(isMcpResourceContents)) return false;
	return isCompleteResult(value, options?.era, true);
}

export function isMcpToolsListResult(value: unknown, options?: McpResultGuardOptions): value is McpToolsListResult {
	return isRecord(value) && Array.isArray(value.tools) && isCompleteResult(value, options?.era, true);
}

export function isMcpResourcesListResult(
	value: unknown,
	options?: McpResultGuardOptions,
): value is McpResourcesListResult {
	return isRecord(value) && Array.isArray(value.resources) && isCompleteResult(value, options?.era, true);
}

export function isMcpPromptsListResult(value: unknown, options?: McpResultGuardOptions): value is McpPromptsListResult {
	return (
		isRecord(value) &&
		Array.isArray(value.prompts) &&
		value.prompts.every(isMcpPrompt) &&
		isCompleteResult(value, options?.era, true)
	);
}

export function isMcpPromptGetResult(value: unknown, options?: McpResultGuardOptions): value is McpPromptGetResult {
	if (!isRecord(value) || !Array.isArray(value.messages)) return false;
	if (!value.messages.every(isMcpPromptMessage)) return false;
	return isCompleteResultType(value.resultType, options?.era);
}

export function isMcpInitializeResult(value: unknown): value is McpInitializeResult {
	if (!isRecord(value) || typeof value.protocolVersion !== "string" || !isRecord(value.serverInfo)) return false;
	return typeof value.serverInfo.name === "string" && typeof value.serverInfo.version === "string";
}

export function isMcpRequestMeta(value: unknown): value is McpRequestMeta {
	if (!isRecord(value)) return false;
	if (
		value.progressToken !== undefined &&
		typeof value.progressToken !== "string" &&
		typeof value.progressToken !== "number"
	)
		return false;
	if (typeof value["io.modelcontextprotocol/protocolVersion"] !== "string") return false;
	if (
		value["io.modelcontextprotocol/clientInfo"] !== undefined &&
		!isMcpClientInfo(value["io.modelcontextprotocol/clientInfo"])
	)
		return false;
	if (
		value["io.modelcontextprotocol/logLevel"] !== undefined &&
		typeof value["io.modelcontextprotocol/logLevel"] !== "string"
	)
		return false;
	return isMcpCapabilities(value["io.modelcontextprotocol/clientCapabilities"]);
}

export function isMcpDiscoverResult(value: unknown, options?: McpResultGuardOptions): value is McpDiscoverResult {
	if (!isRecord(value) || !isCompleteResultType(value.resultType, options?.era)) return false;
	if (
		!Array.isArray(value.supportedVersions) ||
		!value.supportedVersions.every((version) => typeof version === "string")
	)
		return false;
	if (!isMcpCapabilities(value.capabilities)) return false;
	if (typeof value.ttlMs !== "number" || !Number.isFinite(value.ttlMs) || value.ttlMs < 0) return false;
	return value.cacheScope === "public" || value.cacheScope === "private";
}

export function isMcpTask(value: unknown): value is McpTask {
	if (!isRecord(value)) return false;
	if (typeof value.taskId !== "string" || typeof value.status !== "string") return false;
	if (!isMcpTaskStatus(value.status)) return false;
	if (typeof value.createdAt !== "string" || typeof value.lastUpdatedAt !== "string") return false;
	if (value.ttlMs !== null && (typeof value.ttlMs !== "number" || !Number.isInteger(value.ttlMs) || value.ttlMs < 0))
		return false;
	if (
		value.pollIntervalMs !== undefined &&
		(typeof value.pollIntervalMs !== "number" || !Number.isInteger(value.pollIntervalMs) || value.pollIntervalMs < 0)
	)
		return false;
	return true;
}

export function isMcpSubscriptionsListenResult(value: unknown): value is McpSubscriptionsListenResult {
	return (
		isRecord(value) &&
		value.resultType === "complete" &&
		isRecord(value._meta) &&
		(typeof value._meta[MCP_SUBSCRIPTION_ID_META_KEY] === "string" ||
			typeof value._meta[MCP_SUBSCRIPTION_ID_META_KEY] === "number")
	);
}

function isCompleteResultType(value: unknown, era: McpProtocolEra | undefined): boolean {
	if (value === undefined) return era !== "modern";
	return value === "complete";
}

function isCompleteResult(value: McpJsonObject, era: McpProtocolEra | undefined, cacheable: boolean): boolean {
	if (!isCompleteResultType(value.resultType, era)) return false;
	return era !== "modern" || !cacheable || isMcpCacheableResult(value);
}

function isMcpContent(value: unknown): value is McpContent {
	if (!isRecord(value) || typeof value.type !== "string") return false;
	if (value.type === "text") return typeof value.text === "string";
	if (value.type === "image" || value.type === "audio")
		return typeof value.data === "string" && typeof value.mimeType === "string";
	if (value.type === "resource_link") return typeof value.uri === "string" && typeof value.name === "string";
	if (value.type === "resource") return isMcpResourceContents(value.resource);
	return false;
}

function isMcpPromptMessage(value: unknown): boolean {
	return isRecord(value) && (value.role === "user" || value.role === "assistant") && isMcpContent(value.content);
}

function isMcpPrompt(value: unknown): boolean {
	if (!isRecord(value) || typeof value.name !== "string") return false;
	if (value.title !== undefined && typeof value.title !== "string") return false;
	if (value.description !== undefined && typeof value.description !== "string") return false;
	if (value.arguments === undefined) return true;
	return Array.isArray(value.arguments) && value.arguments.every(isMcpPromptArgument);
}

function isMcpPromptArgument(value: unknown): boolean {
	if (!isRecord(value) || typeof value.name !== "string") return false;
	if (value.title !== undefined && typeof value.title !== "string") return false;
	if (value.description !== undefined && typeof value.description !== "string") return false;
	return value.required === undefined || typeof value.required === "boolean";
}

function isMcpResourceContents(value: unknown): value is McpResourceContents {
	if (!isRecord(value) || typeof value.uri !== "string") return false;
	return (
		(typeof value.text === "string" && value.blob === undefined) ||
		(typeof value.blob === "string" && value.text === undefined)
	);
}

function isMcpInputRequests(value: unknown): value is McpInputRequests {
	if (!isRecord(value)) return false;
	return Object.values(value).every((request) => {
		if (!isRecord(request) || typeof request.method !== "string") return false;
		return request.params === undefined || isRecord(request.params);
	});
}

function isMcpClientInfo(value: unknown): value is McpClientInfo {
	return isRecord(value) && typeof value.name === "string" && typeof value.version === "string";
}

function isMcpCapabilities(value: unknown): value is McpCapabilities {
	if (!isRecord(value)) return false;
	for (const [key, capability] of Object.entries(value)) {
		if (!isRecord(capability)) return false;
		if (key === "tools" && capability.listChanged !== undefined && typeof capability.listChanged !== "boolean")
			return false;
		if (key === "resources") {
			if (capability.subscribe !== undefined && typeof capability.subscribe !== "boolean") return false;
			if (capability.listChanged !== undefined && typeof capability.listChanged !== "boolean") return false;
		}
	}
	return true;
}

function isMcpTaskStatus(value: string): value is McpTask["status"] {
	return ["working", "input_required", "completed", "failed", "cancelled"].includes(value);
}

function isRecord(value: unknown): value is McpJsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
