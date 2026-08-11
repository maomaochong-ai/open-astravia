import type { Static, TSchema } from "@sinclair/typebox";
import type { AgentToolResult, AgentToolUpdateCallback } from "@vetta/agent-core";
import type { ConversationScenario } from "@vetta/runtime-core";
import type { Theme } from "../modes/interactive/theme/theme.js";
import type { ExtensionContext } from "./context-contracts.js";
import type { Component } from "./ui-primitives.js";

export type { AgentToolResult, AgentToolUpdateCallback };

/** Rendering options for tool results */
export interface ToolRenderResultOptions {
	/** Whether the result view is expanded */
	expanded: boolean;
	/** Whether this is a partial/streaming result */
	isPartial: boolean;
}

/** Optional model-facing guidance contributed while this tool is active. */
export interface ExtensionToolPromptContribution {
	readonly summary?: string;
	readonly guidelines?: readonly string[];
}

/**
 * Tool definition for registerTool().
 */
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
	/** Tool name (used in LLM tool calls) */
	name: string;
	/** Human-readable label for UI */
	label: string;
	/** Description for LLM */
	description: string;
	/** Parameter schema (TypeBox) */
	parameters: TParams;
	/** Normalize provider arguments before the declared schema validates them. */
	normalizeInput?: (input: unknown) => unknown;
	/** Optional schema-dialect validator/decoder applied after normalization. */
	validateInput?: (input: unknown) => Static<TParams>;
	/** Structured prompt metadata, published only while this tool is active. */
	prompt?: ExtensionToolPromptContribution;

	/**
	 * 工具可用性元数据（见 AgentTool 同名字段）。host-custom / plugin / extension 工具
	 * 经此声明可见场景；fail-closed：缺省/空 = 所有场景都不激活。透传到 wrapRegisteredTool。
	 */
	scope_use?: readonly ConversationScenario[];
	requires?: string[];
	category?: string;

	/** Execute the tool. */
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<TDetails>>;

	/** Custom rendering for tool call display */
	renderCall?: (args: Static<TParams>, theme: Theme) => Component;

	/** Custom rendering for tool result display */
	renderResult?: (result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme) => Component;
}

/** Tool info with name, description, and parameter schema. */
export type ToolInfo = Pick<ToolDefinition, "name" | "description" | "parameters">;
