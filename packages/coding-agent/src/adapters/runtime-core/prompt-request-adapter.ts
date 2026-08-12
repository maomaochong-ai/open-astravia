import type { ImageContent, UserMessage } from "@vetta/ai";
import type { EcosystemHookRuntime } from "@vetta/ecosystem-adapter/hooks";
import type { PromptAttachmentRef, PromptRequest, RuntimePromptAdapter } from "@vetta/runtime-core";
import type {
	RuntimeInputRequestPreparationContext,
	RuntimeInputRequestPreparationResult,
	RuntimeInputRequestPreparer,
	RuntimeSnapshotAcquireContext,
	SessionContextRecord,
	SessionInput,
	SessionInputRequest,
} from "@vetta/runtime-core/kernel";
import type { InputEventResult, InputSource } from "../../extensions/index.js";
import {
	PROMPT_ATTACHMENT_CONTEXT_TYPE,
	PROMPT_ATTACHMENT_REFERENCE_TYPE,
	PROMPT_RESOURCE_REFERENCE_TYPE,
} from "../../model-context/index.js";
import { CODING_AGENT_EXTENSION_INPUT_SOURCE_METADATA_KEY } from "../../runtime-contracts/extension-runtime.js";
import type {
	CodingAgentPromptResourceExpansion,
	CodingAgentPromptResourceResolver,
} from "../../runtime-contracts/index.js";
import {
	type AgentPluginPromptContext,
	buildPluginPromptContextMessage,
	parsePluginPromptContexts,
} from "./plugin-prompt-context.js";

export type {
	CodingAgentPromptResourceExpansion,
	CodingAgentPromptResourceResolver,
} from "../../runtime-contracts/index.js";

export interface CodingAgentPromptRequestAdapterOptions {
	readonly now?: () => number;
	readonly resolvePromptResource?: CodingAgentPromptResourceResolver;
	readonly hookRuntime?: EcosystemHookRuntime;
	readonly extensionEvents?: CodingAgentPromptInputInterceptor;
	readonly inputSource?: Exclude<InputSource, "extension">;
	readonly onPrepared?: () => Promise<void> | void;
}

/** 将 coding-agent 宿主语义翻译成业务无关的 Kernel 输入。 */
export class CodingAgentPromptRequestAdapter implements RuntimePromptAdapter, RuntimeInputRequestPreparer {
	private readonly now: () => number;
	private readonly resolvePromptResource: CodingAgentPromptResourceResolver | undefined;
	private readonly hookRuntime: EcosystemHookRuntime | undefined;
	private readonly extensionEvents: CodingAgentPromptInputInterceptor | undefined;
	private readonly inputSource: Exclude<InputSource, "extension">;
	private readonly onPrepared: (() => Promise<void> | void) | undefined;

	constructor(options: CodingAgentPromptRequestAdapterOptions = {}) {
		this.now = options.now ?? Date.now;
		this.resolvePromptResource = options.resolvePromptResource;
		this.hookRuntime = options.hookRuntime;
		this.extensionEvents = options.extensionEvents;
		this.inputSource = options.inputSource ?? "rpc";
		this.onPrepared = options.onPrepared;
	}

	createRequest(request: PromptRequest): SessionInputRequest {
		return Object.freeze({
			payload: structuredClone(request),
			displayText: request.text,
			...(request.modelKey || request.reasoning
				? { model: { key: request.modelKey, reasoning: request.reasoning } }
				: {}),
		});
	}

	bindForTurn(_context: RuntimeSnapshotAcquireContext): RuntimeInputRequestPreparer {
		return new CodingAgentPromptRequestAdapter({
			now: this.now,
			resolvePromptResource: this.resolvePromptResource?.bindForTurn?.() ?? this.resolvePromptResource,
			hookRuntime: this.hookRuntime,
			extensionEvents: this.extensionEvents?.bindForTurn?.(_context) ?? this.extensionEvents,
			inputSource: this.inputSource,
			onPrepared: this.onPrepared,
		});
	}

	releaseTurnBinding(): Promise<void> | void {
		return this.extensionEvents?.releaseTurnBinding?.();
	}

	async prepare(
		inputRequest: SessionInputRequest,
		context: RuntimeInputRequestPreparationContext,
	): Promise<RuntimeInputRequestPreparationResult> {
		const request = normalizeImagesForModel(readPromptRequest(inputRequest.payload), context);
		const intercepted = await this.intercept(request);
		if (intercepted.action === "handled") return intercepted;
		const input = await this.preparePrompt(intercepted.request, context);
		await this.onPrepared?.();
		return { action: "continue", input };
	}

	private async intercept(
		request: PromptRequest,
	): Promise<{ readonly action: "continue"; readonly request: PromptRequest } | { readonly action: "handled" }> {
		const intercepted = await this.extensionEvents?.interceptInput(
			request.text,
			request.images,
			request.metadata?.[CODING_AGENT_EXTENSION_INPUT_SOURCE_METADATA_KEY] === "extension"
				? "extension"
				: this.inputSource,
		);
		if (intercepted?.action === "handled") return { action: "handled" };
		return {
			action: "continue",
			request:
				intercepted?.action === "transform"
					? { ...request, text: intercepted.text, images: intercepted.images }
					: request,
		};
	}

	private async preparePrompt(
		request: PromptRequest,
		context: RuntimeInputRequestPreparationContext,
	): Promise<SessionInput> {
		const expansion = await this.expandPrompt(request, context);
		const hookContexts = await this.runPromptHooks(
			expansion.text,
			expansion.skillHookContribution,
			context.turnId,
			context.signal,
		);
		const timestamp = this.now();
		const attachmentContext = request.attachments?.length
			? buildPromptAttachmentContext(request.attachments)
			: undefined;
		const pluginPromptContexts = parsePluginPromptContexts(request.metadata?.pluginPromptContexts);
		const pluginPromptContext =
			pluginPromptContexts.length > 0 ? buildPluginPromptContextMessage(pluginPromptContexts) : undefined;
		const queuedInjection = context.queueing
			? [...hookContexts, attachmentContext, pluginPromptContext, expansion.skillInjection, expansion.sceneInjection]
					.filter(isNonEmptyString)
					.join("\n\n")
			: "";
		const text = queuedInjection ? `${queuedInjection}\n\n${expansion.text}` : expansion.text;
		const content: Array<{ readonly type: "text"; readonly text: string } | ImageContent> = [
			{ type: "text", text },
			...(request.images ?? []),
		];
		const message: UserMessage = {
			role: "user",
			content,
			timestamp,
		};
		const contextRecords = context.queueing
			? []
			: [
					...hookContexts.map((content) => hiddenContext("ecosystem_hook_context", content)),
					...this.buildContext(request, expansion, pluginPromptContexts),
				];
		return {
			message,
			...(contextRecords.length > 0 ? { context: contextRecords } : {}),
		};
	}

	private async runPromptHooks(
		prompt: string,
		skillHookContribution: CodingAgentPromptResourceExpansion["skillHookContribution"],
		turnId: string,
		signal: AbortSignal,
	): Promise<readonly string[]> {
		if (!this.hookRuntime) return [];
		const sessionStart = await this.hookRuntime.runPendingSessionStart(signal);
		if (sessionStart?.shouldStop || sessionStart?.shouldBlock) {
			throw new Error(
				sessionStart.stopReason ?? sessionStart.blockReason ?? "Session start blocked by ecosystem hook",
			);
		}
		const promptSubmit = await this.hookRuntime.runUserPromptSubmit(
			prompt,
			signal,
			skillHookContribution ? [skillHookContribution] : [],
			turnId,
		);
		if (promptSubmit.shouldStop || promptSubmit.shouldBlock) {
			throw new Error(promptSubmit.stopReason ?? promptSubmit.blockReason ?? "Prompt blocked by ecosystem hook");
		}
		return [...(sessionStart?.additionalContexts ?? []), ...promptSubmit.additionalContexts];
	}

	private async expandPrompt(
		request: PromptRequest,
		context: RuntimeInputRequestPreparationContext,
	): Promise<CodingAgentPromptResourceExpansion> {
		if (!request.promptRef) return { text: request.text };
		if (/^\/(?:skill|scene):/.test(request.text)) {
			throw new Error("Prompt must not contain a Skill / Scene command when promptRef is provided");
		}
		const name = request.promptRef.name.trim();
		if (!name) throw new Error("Prompt resource name must not be empty");
		const promptRef = { ...request.promptRef, name };
		return this.resolvePromptResource
			? this.resolvePromptResource(request.text, promptRef, context)
			: { text: request.text, promptRef };
	}

	private buildContext(
		request: PromptRequest,
		expansion: CodingAgentPromptResourceExpansion,
		pluginPromptContexts: readonly AgentPluginPromptContext[],
	): readonly SessionContextRecord[] {
		const records: SessionContextRecord[] = [];
		const pluginInstructions = Array.isArray(request.metadata?.pluginInstructions)
			? request.metadata.pluginInstructions.filter(isNonEmptyString)
			: [];
		for (const instruction of pluginInstructions) {
			records.push(hiddenContext("plugin_prompt_instruction", instruction.trim()));
		}
		if (pluginPromptContexts.length > 0) {
			records.push(
				hiddenContext("plugin_prompt_context", buildPluginPromptContextMessage(pluginPromptContexts), {
					contexts: pluginPromptContexts,
				}),
			);
		}

		if (request.metadata?.knowledgeMode === true) {
			records.push(hiddenContext("knowledge_mode_instruction", KNOWLEDGE_MODE_INSTRUCTION));
		}

		const settingsAssistInstruction =
			typeof request.metadata?.settingsAssistInstruction === "string"
				? request.metadata.settingsAssistInstruction.trim()
				: "";
		if (settingsAssistInstruction) {
			const tabId =
				typeof request.metadata?.settingsAssistTabId === "string"
					? request.metadata.settingsAssistTabId.trim()
					: "";
			records.push(
				hiddenContext("settings_assist_instruction", settingsAssistInstruction, tabId ? { tabId } : undefined),
			);
		}

		if (request.attachments !== undefined) {
			const hasAttachments = request.attachments.length > 0;
			records.push({
				...hiddenContext(
					hasAttachments ? PROMPT_ATTACHMENT_CONTEXT_TYPE : PROMPT_ATTACHMENT_REFERENCE_TYPE,
					hasAttachments ? buildPromptAttachmentContext(request.attachments) : "",
					{ attachments: request.attachments },
				),
				modelVisible: hasAttachments,
			});
		}

		const promptRef = expansion.promptRef ?? request.promptRef;
		if (promptRef && !expansion.skillInjection && !expansion.sceneInjection) {
			records.push({
				...hiddenContext(PROMPT_RESOURCE_REFERENCE_TYPE, "", { promptRef }),
				modelVisible: false,
			});
		}
		if (expansion.skillInjection) {
			records.push(
				hiddenContext("skill_expansion", expansion.skillInjection, promptRef ? { promptRef } : undefined),
			);
		}
		if (expansion.sceneInjection) {
			records.push(
				hiddenContext("scene_expansion", expansion.sceneInjection, promptRef ? { promptRef } : undefined),
			);
		}
		return records;
	}
}

function normalizeImagesForModel(
	request: PromptRequest,
	context: RuntimeInputRequestPreparationContext,
): PromptRequest {
	if (
		!request.images ||
		request.images.length === 0 ||
		!context.modelBinding ||
		context.modelBinding.model.input.includes("image")
	) {
		return request;
	}
	return {
		...request,
		images: undefined,
		text:
			request.text === "(see attached images)"
				? "(User attempted to send images, but the current model does not support image input. Please inform the user that this model cannot process images.)"
				: request.text,
	};
}

interface CodingAgentPromptInputInterceptor {
	bindForTurn?(context: RuntimeSnapshotAcquireContext): CodingAgentPromptInputInterceptor;
	releaseTurnBinding?(): Promise<void> | void;
	interceptInput(text: string, images: ImageContent[] | undefined, source: InputSource): Promise<InputEventResult>;
}

function hiddenContext(type: string, content: string, metadata?: unknown): SessionContextRecord {
	return {
		type,
		content,
		modelVisible: true,
		display: false,
		...(metadata === undefined ? {} : { metadata }),
	};
}

function buildPromptAttachmentContext(attachments: readonly PromptAttachmentRef[]): string {
	const serialized = JSON.stringify(attachments).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
	return [
		"<prompt_attachments>",
		serialized,
		"</prompt_attachments>",
		"These are absolute filesystem references attached by the user. Use the available tools to read them only when needed.",
	].join("\n");
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function readPromptRequest(value: unknown): PromptRequest {
	if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") {
		throw new Error("Invalid Turn-bound Prompt request");
	}
	return value as PromptRequest;
}

const KNOWLEDGE_MODE_INSTRUCTION =
	"用户已开启「知识检索」：本轮请优先查询本地知识库来回答。" +
	"先用 kb_list_available_tags 看有哪些标签，再用 kb_filter_by_tags 按相关标签筛页（all/any/none 交并补），" +
	"或读 indexes/ 下的导航地图定位，再用 read 打开命中的 wiki 页（用工具返回的绝对路径）、" +
	"顺正文里的 [[page-id]] 链接深入；必要时用 grep 全文检索。" +
	"标签只是捷径：若 kb_filter_by_tags 没命中、或命中的页其实答不上问题，不要就此打住——" +
	"换用别的标签重试、改走 indexes/ 地图、grep 全文、浏览 wiki/ 树并顺 [[page-id]] 链接深挖，" +
	"多条线索交叉印证后再下结论。" +
	"基于知识库内容作答并说明依据；只有在这些途径都查空后，才如实告知知识库无相关内容并退回常规回答。";
