import type {
	Tool as BedrockTool,
	ConverseStreamCommandInput,
	ToolChoice,
	ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import type { Context, Model, ThinkingBudgets, ThinkingLevel, Tool } from "../../types.js";
import { buildSystemPrompt, convertBedrockMessages, resolveCacheRetention } from "./messages.js";
import type { BedrockOptions } from "./options.js";
import { mapThinkingLevelToEffort, supportsAdaptiveThinking } from "./options.js";

export function buildBedrockCommandInput(
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options: BedrockOptions,
): ConverseStreamCommandInput {
	const cacheRetention = resolveCacheRetention(options.cacheRetention);
	return {
		modelId: model.id,
		messages: convertBedrockMessages(context, model, cacheRetention),
		system: buildSystemPrompt(context.systemPrompt, model, cacheRetention),
		inferenceConfig: { maxTokens: options.maxTokens, temperature: options.temperature },
		toolConfig: convertToolConfig(context.tools, options.toolChoice),
		additionalModelRequestFields: buildAdditionalModelRequestFields(model, options),
	};
}

function convertToolConfig(
	tools: Tool[] | undefined,
	toolChoice: BedrockOptions["toolChoice"],
): ToolConfiguration | undefined {
	if (!tools?.length || toolChoice === "none") return undefined;
	const bedrockTools: BedrockTool[] = tools.map((tool) => ({
		toolSpec: {
			name: tool.name,
			description: tool.description,
			inputSchema: { json: tool.parameters },
		},
	}));
	let bedrockToolChoice: ToolChoice | undefined;
	if (toolChoice === "auto") bedrockToolChoice = { auto: {} };
	else if (toolChoice === "any") bedrockToolChoice = { any: {} };
	else if (toolChoice?.type === "tool") bedrockToolChoice = { tool: { name: toolChoice.name } };
	return { tools: bedrockTools, toolChoice: bedrockToolChoice };
}

function buildAdditionalModelRequestFields(
	model: Model<"bedrock-converse-stream">,
	options: BedrockOptions,
): ConverseStreamCommandInput["additionalModelRequestFields"] {
	if (!options.reasoning || !model.reasoning) return undefined;
	if (!model.id.includes("anthropic.claude") && !model.id.includes("anthropic/claude")) return undefined;

	if (supportsAdaptiveThinking(model.id)) {
		return {
			thinking: { type: "adaptive" },
			output_config: { effort: mapThinkingLevelToEffort(options.reasoning, model.id) },
		};
	}
	const thinking = {
		type: "enabled",
		budget_tokens: resolveThinkingBudget(options.reasoning, options.thinkingBudgets),
	};
	return (options.interleavedThinking ?? true)
		? { thinking, anthropic_beta: ["interleaved-thinking-2025-05-14"] }
		: { thinking };
}

function resolveThinkingBudget(reasoning: string, customBudgets?: ThinkingBudgets): number {
	const defaultBudgets: Record<ThinkingLevel, number> = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
		xhigh: 16384,
	};
	const level = reasoning === "xhigh" ? "high" : reasoning;
	return customBudgets?.[level as keyof ThinkingBudgets] ?? defaultBudgets[reasoning as ThinkingLevel];
}
