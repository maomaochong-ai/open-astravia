import type { AgentMessage } from "@vetta/agent-core";
import type { ImageContent } from "@vetta/ai";
import type {
	AgentRunPreparationContext,
	AgentRunPreparationResult,
	AgentRunPreparer,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
	SessionInput,
} from "@vetta/runtime-core/kernel";
import type { InputEventResult, InputSource } from "../../extensions/index.js";
import type {
	ExtensionRunnerGenerationOwner,
	ExtensionRunnerLease,
} from "../../extensions/runtime/extension-runner-generations.js";
import type { CodingAgentToolInterceptor } from "../../interception/tool/contracts.js";
import type { CodingAgentExtensionRunnerPort } from "../../runtime-contracts/index.js";
import { createExtensionToolInterceptor, wrapRuntimeToolsWithExtensions } from "./extension-tool-wrapper.js";

/**
 * Session 级 Extension 事件桥。
 *
 * Composition Root 在 Session 构建时持有桥，宿主随后绑定 Runner；因此 Prompt 与
 * Tool Frame 只依赖稳定桥接口，不依赖 CLI 生命周期或 Extension Loader。
 */
export class CodingAgentExtensionRunAdapter implements AgentRunPreparer {
	private runner: CodingAgentExtensionRunnerPort | undefined;
	private runnerLease: ExtensionRunnerLease | undefined;
	private baseSystemPrompt = "";
	private systemPrompt = "";
	private runSystemPromptOverride: string | undefined;

	constructor(private readonly runnerGenerations?: ExtensionRunnerGenerationOwner) {}

	bind(
		runner: CodingAgentExtensionRunnerPort,
		options: { readonly replaceExisting?: boolean; readonly sessionId?: string } = {},
	): () => Promise<void> {
		if (this.runner && this.runner !== runner && options.replaceExisting !== true) {
			throw new Error("Extension run adapter is already bound");
		}
		const sessionId = options.sessionId ?? this.boundSessionId;
		this.boundSessionId = sessionId;
		const releaseGeneration = sessionId ? this.runnerGenerations?.bind(sessionId, runner, options) : undefined;
		this.runner = runner;
		return async () => {
			if (this.runner === runner) this.runner = undefined;
			await releaseGeneration?.();
		};
	}

	private boundSessionId: string | undefined;

	bindForTurn(context: RuntimeSnapshotAcquireContext): CodingAgentExtensionRunAdapter {
		return this.bindAdapterForTurn(context);
	}

	bindAdapterForTurn(context: RuntimeSnapshotAcquireContext): CodingAgentExtensionRunAdapter {
		this.boundSessionId ??= context.sessionId;
		const lease = this.runnerGenerations?.acquire(context.sessionId, context.operationId);
		const bound = new CodingAgentExtensionRunAdapter();
		bound.runner = lease?.runner ?? this.runner;
		bound.runnerLease = lease;
		return bound;
	}

	releaseTurnBinding(): void {
		this.runnerLease?.release();
		this.runnerLease = undefined;
	}

	ownsTurn(turnId: string, runner: CodingAgentExtensionRunnerPort): boolean {
		return this.boundSessionId
			? (this.runnerGenerations?.ownsTurn(this.boundSessionId, turnId, runner) ?? this.runner === runner)
			: this.runner === runner;
	}

	async interceptInput(
		text: string,
		images: ImageContent[] | undefined,
		source: InputSource,
	): Promise<InputEventResult> {
		return this.runner?.emitInput(text, images, source) ?? { action: "continue" };
	}

	wrapTools(tools: ReadonlyMap<string, RuntimeToolDefinition>): ReadonlyMap<string, RuntimeToolDefinition> {
		return this.runner ? wrapRuntimeToolsWithExtensions(tools, this.runner) : tools;
	}

	createToolInterceptor(): CodingAgentToolInterceptor {
		return createExtensionToolInterceptor(() => this.runner);
	}

	async transformContext(messages: readonly AgentMessage[]): Promise<readonly AgentMessage[]> {
		return this.runner ? this.runner.emitContext([...messages]) : messages;
	}

	async prepare(context: AgentRunPreparationContext): Promise<AgentRunPreparationResult | undefined> {
		this.runSystemPromptOverride = undefined;
		this.systemPrompt = this.baseSystemPrompt;
		const runner = this.runner;
		if (!runner?.hasHandlers("before_agent_start")) return undefined;

		const { prompt, images } = readPromptInput(context.input);
		const baseSystemPrompt = await context.resolveSystemPrompt();
		const result = await runner.emitBeforeAgentStart(prompt, images, baseSystemPrompt);
		if (!result) return undefined;
		if (result.systemPrompt) {
			this.runSystemPromptOverride = result.systemPrompt;
			this.systemPrompt = result.systemPrompt;
		}

		return {
			...(result.messages
				? {
						context: result.messages.map((message) => ({
							type: message.customType,
							content: message.content,
							modelVisible: true,
							display: message.display,
							metadata: message.details,
						})),
					}
				: {}),
			...(result.systemPrompt
				? {
						instructionOverride: [
							{
								id: "coding-agent.extension.before-agent-start",
								content: result.systemPrompt,
								priority: 0,
							},
						],
					}
				: {}),
		};
	}

	recordSystemPrompt(systemPrompt: string): void {
		this.baseSystemPrompt = systemPrompt;
		this.systemPrompt = this.runSystemPromptOverride ?? systemPrompt;
	}

	readSystemPrompt(): string {
		return this.systemPrompt;
	}
}

function readPromptInput(input: SessionInput): {
	readonly prompt: string;
	readonly images: ImageContent[] | undefined;
} {
	const content = input.message.content;
	if (typeof content === "string") return { prompt: content, images: undefined };
	const images = content.filter((block): block is ImageContent => block.type === "image");
	return {
		prompt: content
			.filter((block) => block.type === "text")
			.map(({ text }) => text)
			.join(""),
		images: images.length > 0 ? images : undefined,
	};
}
