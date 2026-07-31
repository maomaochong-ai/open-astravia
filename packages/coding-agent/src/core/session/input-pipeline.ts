/**
 * Input pipeline — prompt / steer / follow-up / custom + user messages.
 *
 * Extracted from AgentSession. This is the turn-entry orchestration: it runs the
 * per-prompt lazy reloads, expands skills/templates, normalizes images, validates
 * model/API key, builds the message array (with skill/scene/extension injections),
 * and drives the agent. It also owns the ad-hoc todo-nudge signature and provides
 * the agent's continuationProvider (todo continuation).
 */

import { join } from "node:path";
import type { AgentMessage } from "@vetta/agent-core";
import type { AssistantMessage, ImageContent, TextContent } from "@vetta/ai";
import { getDocsPath } from "../../config.js";
import type { PromptOptions } from "../agent-session.js";
import {
	type CustomMessage,
	PROMPT_ATTACHMENT_CONTEXT_TYPE,
	PROMPT_ATTACHMENT_REFERENCE_TYPE,
	PROMPT_RESOURCE_REFERENCE_TYPE,
} from "../messages.js";
import { expandPromptTemplate } from "../prompt-templates.js";
import type { ResourceLoader } from "../resource-loader.js";
import type { TodoStore } from "../todo-store.js";
import type { BashController } from "./bash-controller.js";
import type { CompactionController } from "./compaction-controller.js";
import { normalizeUserImages } from "./normalize-images.js";
import type { QueueController } from "./queue-controller.js";
import type { RetryController } from "./retry-controller.js";
import type { RuntimeManager } from "./runtime-manager.js";
import type { SessionContext } from "./session-context.js";
import { expandSkillCommand, expandSkillReference } from "./skill-expansion.js";
import { buildTodoContinuationMessages } from "./todo-continuation.js";
import type { PromptAttachmentRef } from "./types.js";

export interface InputPipelineDeps {
	runtime: RuntimeManager;
	queue: QueueController;
	bash: BashController;
	retry: RetryController;
	compaction: CompactionController;
	todoStore: TodoStore;
	resourceLoader: ResourceLoader;
}

function buildPromptAttachmentContext(attachments: PromptAttachmentRef[]): string {
	const serialized = JSON.stringify(attachments).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
	return [
		"<prompt_attachments>",
		serialized,
		"</prompt_attachments>",
		"These are absolute filesystem references attached by the user. Use the available tools to read them only when needed.",
	].join("\n");
}

export class InputPipeline {
	/**
	 * Signature of the pending-todo set we last nudged for, for ad-hoc (unlocked) lists.
	 * Reset on every new user prompt so each turn gets one fresh nudge.
	 */
	private _lastTodoNudgeSignature: string | undefined = undefined;

	private readonly runtime: RuntimeManager;
	private readonly queue: QueueController;
	private readonly bash: BashController;
	private readonly retry: RetryController;
	private readonly compaction: CompactionController;
	private readonly todoStore: TodoStore;
	private readonly resourceLoader: ResourceLoader;

	constructor(
		private readonly ctx: SessionContext,
		deps: InputPipelineDeps,
	) {
		this.runtime = deps.runtime;
		this.queue = deps.queue;
		this.bash = deps.bash;
		this.retry = deps.retry;
		this.compaction = deps.compaction;
		this.todoStore = deps.todoStore;
		this.resourceLoader = deps.resourceLoader;
	}

	/**
	 * Build follow-up messages for uncompleted todo items.
	 * Called by the agent core's continuationProvider INSIDE the loop, before the
	 * agent decides whether to exit.
	 */
	buildTodoContinuationMessages(): AgentMessage[] {
		const result = buildTodoContinuationMessages(this.todoStore, this._lastTodoNudgeSignature);
		this._lastTodoNudgeSignature = result.nextNudgeSignature;
		return result.messages;
	}

	async prompt(text: string, options?: PromptOptions): Promise<void> {
		const expandPromptTemplates = options?.expandPromptTemplates ?? true;

		// Detect newly added/modified skills on disk and rebuild the system prompt
		// so this turn sees them. Cheap stat-only fingerprint check.
		this.runtime.refreshSkillsForPrompt();

		// Lazy MCP reload: if mcp.json changed since last time, diff-reload changed servers.
		await this.runtime.maybeReloadMcpForPrompt();

		// Lazy image-budget reread: desktop "context strategy" edits take effect this turn.
		this.ctx.settingsManager.reloadImageSettings();

		// Lazy personalization rebuild: persona / custom-instruction edits take effect this turn.
		this.runtime.maybeReloadPersonalizationForPrompt();

		// Lazy ask_user_question rebuild: capability toggle takes effect this turn.
		this.runtime.maybeReloadAskUserQuestionForPrompt();

		// Handle extension commands first (execute immediately, even during streaming)
		// Extension commands manage their own LLM interaction via pi.sendMessage()
		if (expandPromptTemplates && text.startsWith("/")) {
			const handled = await this.runtime.tryExecuteExtensionCommand(text);
			if (handled) {
				// Extension command executed, no prompt to send
				return;
			}
		}

		// Emit input event for extension interception (before skill/template expansion)
		let currentText = text;
		let currentImages = options?.images;
		const runner = this.runtime.extensionRunner;
		if (runner?.hasHandlers("input")) {
			const inputResult = await runner.emitInput(currentText, currentImages, options?.source ?? "interactive");
			if (inputResult.action === "handled") {
				return;
			}
			if (inputResult.action === "transform") {
				currentText = inputResult.text;
				currentImages = inputResult.images ?? currentImages;
			}
		}

		// Normalize user-attached images (paste / drag / desktop attach) through the
		// same resize pipeline as the read tool. Without this, large pasted images
		// reach the model at original resolution and can blow past local VL models'
		// GPU memory budget (CUDA OOM → 500 no body).
		const normalizedImages = await this.normalizeUserImages(currentImages);
		currentImages = normalizedImages.images;
		if (normalizedImages.notes.length > 0) {
			currentText = [currentText, ...normalizedImages.notes].filter(Boolean).join("\n\n");
		}

		// Expand skill commands (/skill:name args) and prompt templates (/template args)
		let expandedText = currentText;
		let sceneInjection: string | undefined;
		let skillInjection: string | undefined;
		let promptRef = options?.promptRef;
		if (promptRef && /^\/(?:skill|scene):/.test(expandedText)) {
			throw new Error("Prompt must not contain a Skill / Scene command when promptRef is provided");
		}
		if (promptRef || expandPromptTemplates) {
			const expanded = promptRef
				? expandSkillReference(expandedText, promptRef, this.skillExpansionDeps())
				: this.expandSkillCommand(expandedText);
			expandedText = expanded.text;
			sceneInjection = expanded.sceneInjection;
			skillInjection = expanded.skillInjection;
			promptRef = expanded.promptRef;
		}
		if (expandPromptTemplates) {
			expandedText = expandPromptTemplate(expandedText, [...this.resourceLoader.getPrompts().prompts]);
		}

		// If streaming, queue via steer() or followUp() based on option
		if (this.ctx.agent.state.isStreaming) {
			if (!options?.streamingBehavior) {
				throw new Error(
					"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
				);
			}
			const hookContexts = await this.runPromptHooks(expandedText);
			// For streaming, combine injections with user text since we can't inject custom messages
			const attachmentContext = options?.attachments?.length
				? buildPromptAttachmentContext(options.attachments)
				: undefined;
			const injection = [...hookContexts, attachmentContext, skillInjection, sceneInjection]
				.filter(Boolean)
				.join("\n\n");
			const textForStream = injection ? `${injection}\n\n${expandedText}` : expandedText;
			if (options.streamingBehavior === "followUp") {
				this.queue.queueFollowUp(textForStream, currentImages);
			} else {
				this.queue.queueSteer(textForStream, currentImages);
			}
			return;
		}

		// Flush any pending bash messages before the new prompt
		this.bash.flushPending();

		// Validate model
		const model = this.ctx.model;
		if (!model) {
			throw new Error(
				"No model selected.\n\n" +
					`Use /login or set an API key environment variable. See ${join(getDocsPath(), "providers.md")}\n\n` +
					"Then use /model to select a model.",
			);
		}

		// Validate API key
		const apiKey = await this.ctx.modelRegistry.getApiKey(model);
		if (!apiKey) {
			const isOAuth = this.ctx.modelRegistry.isUsingOAuth(model);
			if (isOAuth) {
				throw new Error(
					`Authentication failed for "${model.provider}". ` +
						`Credentials may have expired or network is unavailable. ` +
						`Run '/login ${model.provider}' to re-authenticate.`,
				);
			}
			throw new Error(
				`No API key found for ${model.provider}.\n\n` +
					`Use /login or set an API key environment variable. See ${join(getDocsPath(), "providers.md")}`,
			);
		}

		const hookContexts = await this.runPromptHooks(expandedText);

		// Check if we need to compact before sending (catches aborted responses)
		const lastAssistant = this.findLastAssistantMessage();
		if (lastAssistant) {
			await this.compaction.checkCompaction(lastAssistant, false);
		}

		// Build messages array (custom message if any, then user message)
		const messages: AgentMessage[] = [];
		for (const content of hookContexts) {
			messages.push({
				role: "custom",
				customType: "ecosystem_hook_context",
				content,
				display: false,
				timestamp: Date.now(),
			});
		}

		const pluginInstructions = Array.isArray(options?.metadata?.pluginInstructions)
			? options.metadata.pluginInstructions.filter(
					(instruction): instruction is string => typeof instruction === "string" && instruction.trim().length > 0,
				)
			: [];
		for (const instruction of pluginInstructions) {
			messages.push({
				role: "custom",
				customType: "plugin_prompt_instruction",
				content: instruction.trim(),
				display: false,
				timestamp: Date.now(),
			});
		}

		// Knowledge retrieval mode: user toggled 知识检索 for this turn. Inject a
		// hidden (model-only) instruction telling the agent to consult the knowledge
		// base before answering. Paired with hard isolation below (kb-read tools
		// are stripped unless knowledgeMode is on).
		if (options?.metadata?.knowledgeMode === true) {
			messages.push({
				role: "custom",
				customType: "knowledge_mode_instruction",
				content:
					"用户已开启「知识检索」：本轮请优先查询本地知识库来回答。" +
					"先用 kb_list_available_tags 看有哪些标签，再用 kb_filter_by_tags 按相关标签筛页（all/any/none 交并补），" +
					"或读 indexes/ 下的导航地图定位，再用 read 打开命中的 wiki 页（用工具返回的绝对路径）、" +
					"顺正文里的 [[page-id]] 链接深入；必要时用 grep 全文检索。" +
					"标签只是捷径：若 kb_filter_by_tags 没命中、或命中的页其实答不上问题，不要就此打住——" +
					"换用别的标签重试、改走 indexes/ 地图、grep 全文、浏览 wiki/ 树并顺 [[page-id]] 链接深挖，" +
					"多条线索交叉印证后再下结论。" +
					"基于知识库内容作答并说明依据；只有在这些途径都查空后，才如实告知知识库无相关内容并退回常规回答。",
				display: false,
				timestamp: Date.now(),
			});
		}

		// Settings AI assist: host sends only the user-facing intent as the user
		// message; optional opaque instruction is injected model-only (display:false)
		// so chat UI / history never show the operational preamble.
		const settingsAssistInstruction =
			typeof options?.metadata?.settingsAssistInstruction === "string"
				? options.metadata.settingsAssistInstruction.trim()
				: "";
		if (settingsAssistInstruction.length > 0) {
			const settingsAssistTabId =
				typeof options?.metadata?.settingsAssistTabId === "string"
					? options.metadata.settingsAssistTabId.trim()
					: "";
			messages.push({
				role: "custom",
				customType: "settings_assist_instruction",
				content: settingsAssistInstruction,
				display: false,
				// tabId is UI-only (badge label); not sent to the LLM as content.
				details: settingsAssistTabId ? { tabId: settingsAssistTabId } : undefined,
				timestamp: Date.now(),
			});
		}

		if (options?.attachments !== undefined) {
			const hasAttachments = options.attachments.length > 0;
			messages.push({
				role: "custom",
				customType: hasAttachments ? PROMPT_ATTACHMENT_CONTEXT_TYPE : PROMPT_ATTACHMENT_REFERENCE_TYPE,
				content: hasAttachments ? buildPromptAttachmentContext(options.attachments) : "",
				display: false,
				details: { attachments: options.attachments },
				timestamp: Date.now(),
			});
		}

		// Inject skill/scene content as hidden custom messages (before user message so model sees it first).
		// Skill goes first so the model parses its `<skill>` block before any scene context.
		if (promptRef && !skillInjection && !sceneInjection) {
			messages.push({
				role: "custom",
				customType: PROMPT_RESOURCE_REFERENCE_TYPE,
				content: "",
				display: false,
				details: { promptRef },
				timestamp: Date.now(),
			});
		}
		if (skillInjection) {
			messages.push({
				role: "custom",
				customType: "skill_expansion",
				content: skillInjection,
				display: false,
				details: promptRef ? { promptRef } : undefined,
				timestamp: Date.now(),
			});
		}
		if (sceneInjection) {
			messages.push({
				role: "custom",
				customType: "scene_expansion",
				content: sceneInjection,
				display: false,
				details: promptRef ? { promptRef } : undefined,
				timestamp: Date.now(),
			});
		}

		// Add user message
		const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: expandedText }];
		if (currentImages) {
			userContent.push(...currentImages);
		}
		messages.push({
			role: "user",
			content: userContent,
			timestamp: Date.now(),
		});

		// Inject any pending "nextTurn" messages as context alongside the user message
		messages.push(...this.queue.takeNextTurn());

		// Emit before_agent_start extension event
		const pluginSystemPrompt = await this.runtime.prepareSystemPromptForAgentRun(messages);
		this.ctx.agent.setSystemPrompt(pluginSystemPrompt);
		const beforeStartRunner = this.runtime.extensionRunner;
		if (beforeStartRunner) {
			const result = await beforeStartRunner.emitBeforeAgentStart(expandedText, currentImages, pluginSystemPrompt);
			// Add all custom messages from extensions
			if (result?.messages) {
				for (const msg of result.messages) {
					messages.push({
						role: "custom",
						customType: msg.customType,
						content: msg.content,
						display: msg.display,
						details: msg.details,
						timestamp: Date.now(),
					});
				}
			}
			// Apply extension-modified system prompt, or reset to base
			if (result?.systemPrompt) {
				this.ctx.agent.setSystemPrompt(result.systemPrompt);
			} else {
				// Ensure we're using the base prompt (in case previous turn had modifications)
				this.ctx.agent.setSystemPrompt(pluginSystemPrompt);
			}
		}

		// New user turn: reset the ad-hoc todo nudge so this turn gets one fresh nudge.
		this._lastTodoNudgeSignature = undefined;

		// Hard isolation for knowledge retrieval tools (kb-read: kb_list_available_tags /
		// kb_filter_by_tags). They stay on the session registry via scope_use + requires,
		// but without knowledgeMode this turn strips them so the model cannot call them
		// unless the user activated 知识检索. Exception: kb-processing has no toggle and
		// always needs these tools. Image tools remain soft-isolated (always available).
		// Safe: agent throws if already streaming (no overlap); 本轮 tools 由这里的
		// setTools 定型，prompt() 返回后再还原。注意 agent 的 tools 是实时生效的
		// （见 Agent._liveContext），本轮若有 buildRuntime 重建会覆盖这层过滤。
		const knowledgeToolsEnabled =
			options?.metadata?.knowledgeMode === true || this.runtime.scenario === "kb-processing";
		const savedTools = this.ctx.agent.state.tools;
		const gatedTools = knowledgeToolsEnabled ? savedTools : savedTools.filter((t) => t.category !== "kb-read");
		const toolsGated = gatedTools.length !== savedTools.length;
		if (toolsGated) this.ctx.agent.setTools(gatedTools);
		try {
			await this.ctx.agent.prompt(messages);
		} finally {
			if (toolsGated) this.ctx.agent.setTools(savedTools);
		}
		await this.retry.waitForRetry();
	}

	/**
	 * Queue a steering message to interrupt the agent mid-run.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 */
	async steer(text: string, images?: ImageContent[]): Promise<void> {
		// Check for extension commands (cannot be queued)
		if (text.startsWith("/")) {
			this.runtime.throwIfExtensionCommand(text);
		}

		// Expand skill commands and prompt templates
		const expanded = this.expandSkillCommand(text);
		const injection = [expanded.skillInjection, expanded.sceneInjection].filter(Boolean).join("\n\n");
		let expandedText = injection ? `${injection}\n\n${expanded.text}` : expanded.text;
		expandedText = expandPromptTemplate(expandedText, [...this.resourceLoader.getPrompts().prompts]);

		const normalizedImages = await this.normalizeUserImages(images);
		if (normalizedImages.notes.length > 0) {
			expandedText = [expandedText, ...normalizedImages.notes].filter(Boolean).join("\n\n");
		}

		this.queue.queueSteer(expandedText, normalizedImages.images);
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 * Expands skill commands and prompt templates. Errors on extension commands.
	 */
	async followUp(text: string, images?: ImageContent[]): Promise<void> {
		// Check for extension commands (cannot be queued)
		if (text.startsWith("/")) {
			this.runtime.throwIfExtensionCommand(text);
		}

		// Expand skill commands and prompt templates
		const expanded = this.expandSkillCommand(text);
		const injection = [expanded.skillInjection, expanded.sceneInjection].filter(Boolean).join("\n\n");
		let expandedText = injection ? `${injection}\n\n${expanded.text}` : expanded.text;
		expandedText = expandPromptTemplate(expandedText, [...this.resourceLoader.getPrompts().prompts]);

		const normalizedImages = await this.normalizeUserImages(images);
		if (normalizedImages.notes.length > 0) {
			expandedText = [expandedText, ...normalizedImages.notes].filter(Boolean).join("\n\n");
		}

		this.queue.queueFollowUp(expandedText, normalizedImages.images);
	}

	/**
	 * Send a custom message to the session. Creates a CustomMessageEntry.
	 *
	 * Handles three cases:
	 * - Streaming: queues message, processed when loop pulls from queue
	 * - Not streaming + triggerTurn: appends to state/session, starts new turn
	 * - Not streaming + no trigger: appends to state/session, no turn
	 */
	async sendCustomMessage<T = unknown>(
		message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	): Promise<void> {
		const appMessage = {
			role: "custom" as const,
			customType: message.customType,
			content: message.content,
			display: message.display,
			details: message.details,
			timestamp: Date.now(),
		} satisfies CustomMessage<T>;
		if (options?.deliverAs === "nextTurn") {
			this.queue.pushNextTurn(appMessage);
		} else if (this.ctx.agent.state.isStreaming) {
			if (options?.deliverAs === "followUp") {
				this.ctx.agent.followUp(appMessage);
			} else {
				this.ctx.agent.steer(appMessage);
			}
		} else if (options?.triggerTurn) {
			await this.ctx.agent.prompt(appMessage);
		} else {
			this.ctx.agent.appendMessage(appMessage);
			this.ctx.sessionManager.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display,
				message.details,
			);
			this.ctx.emit({ type: "message_start", message: appMessage });
			this.ctx.emit({ type: "message_end", message: appMessage });
		}
	}

	/**
	 * Send a user message to the agent. Always triggers a turn.
	 * When the agent is streaming, use deliverAs to specify how to queue the message.
	 */
	async sendUserMessage(
		content: string | (TextContent | ImageContent)[],
		options?: { deliverAs?: "steer" | "followUp" },
	): Promise<void> {
		// Normalize content to text string + optional images
		let text: string;
		let images: ImageContent[] | undefined;

		if (typeof content === "string") {
			text = content;
		} else {
			const textParts: string[] = [];
			images = [];
			for (const part of content) {
				if (part.type === "text") {
					textParts.push(part.text);
				} else {
					images.push(part);
				}
			}
			text = textParts.join("\n");
			if (images.length === 0) images = undefined;
		}

		// Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
		await this.prompt(text, {
			expandPromptTemplates: false,
			streamingBehavior: options?.deliverAs,
			images,
			source: "extension",
		});
	}

	private expandSkillCommand(text: string): ReturnType<typeof expandSkillCommand> {
		return expandSkillCommand(text, this.skillExpansionDeps());
	}

	private skillExpansionDeps(): Parameters<typeof expandSkillCommand>[1] {
		const runner = this.runtime.extensionRunner;
		return {
			resourceLoader: this.resourceLoader,
			todoStore: this.todoStore,
			emitError: runner ? (error) => runner.emitError(error) : undefined,
		};
	}

	private async runPromptHooks(prompt: string): Promise<string[]> {
		const sessionStart = await this.ctx.hookRuntime.runPendingSessionStart();
		if (sessionStart?.shouldStop || sessionStart?.shouldBlock) {
			throw new Error(
				sessionStart.stopReason ?? sessionStart.blockReason ?? "Session start blocked by ecosystem hook",
			);
		}
		const promptSubmit = await this.ctx.hookRuntime.runUserPromptSubmit(prompt);
		if (promptSubmit.shouldStop || promptSubmit.shouldBlock) {
			throw new Error(promptSubmit.stopReason ?? promptSubmit.blockReason ?? "Prompt blocked by ecosystem hook");
		}
		return [...(sessionStart?.additionalContexts ?? []), ...promptSubmit.additionalContexts];
	}

	private async normalizeUserImages(
		images?: ImageContent[],
	): Promise<{ images: ImageContent[] | undefined; notes: string[] }> {
		return normalizeUserImages(images, this.ctx.settingsManager.getImageAutoResize());
	}

	private findLastAssistantMessage(): AssistantMessage | undefined {
		const messages = this.ctx.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				return msg as AssistantMessage;
			}
		}
		return undefined;
	}
}
