import type { AgentMessage } from "@vetta/agent-core";
import type { Message, TextContent } from "@vetta/ai";
import type {
	ModelCallMessageFinalizationInput,
	ModelCallMessageFinalizer,
	RuntimeSnapshotAcquireContext,
} from "@vetta/runtime-core/kernel";
import { applyImageBudget } from "./image-budget.js";
import { type ModelInputImageProcessor, normalizeModelInputImages } from "./image-normalization.js";

export interface CodingAgentImageSettingsSource {
	reloadImageSettings?(): void;
	getImageAutoResize?(): boolean;
	getBlockImages?(): boolean;
	getImageRequestHighWatermarkBytes?(): number;
	getImageRequestLowWatermarkBytes?(): number;
}

/** 在最终模型调用边界应用动态图片预算与全局禁图语义。 */
export class CodingAgentModelCallMessageFinalizer implements ModelCallMessageFinalizer {
	constructor(
		private readonly settings?: CodingAgentImageSettingsSource,
		private readonly imageProcessor?: ModelInputImageProcessor,
	) {}

	bindForTurn(context: RuntimeSnapshotAcquireContext): ModelCallMessageFinalizer {
		context.signal.throwIfAborted();
		this.settings?.reloadImageSettings?.();
		const imageAutoResize = this.settings?.getImageAutoResize?.();
		const blockImages = this.settings?.getBlockImages?.();
		const highWatermarkBytes = this.settings?.getImageRequestHighWatermarkBytes?.();
		const lowWatermarkBytes = this.settings?.getImageRequestLowWatermarkBytes?.();
		return new CodingAgentModelCallMessageFinalizer(
			{
				...(imageAutoResize === undefined ? {} : { getImageAutoResize: () => imageAutoResize }),
				...(blockImages === undefined ? {} : { getBlockImages: () => blockImages }),
				...(highWatermarkBytes === undefined
					? {}
					: { getImageRequestHighWatermarkBytes: () => highWatermarkBytes }),
				...(lowWatermarkBytes === undefined ? {} : { getImageRequestLowWatermarkBytes: () => lowWatermarkBytes }),
			},
			this.imageProcessor,
		);
	}

	async finalize(input: ModelCallMessageFinalizationInput, signal: AbortSignal): Promise<readonly Message[]> {
		signal.throwIfAborted();
		const normalized =
			this.settings?.getImageAutoResize?.() === false
				? [...input.messages]
				: await normalizeModelInputImages(
						input.messages,
						signal,
						this.imageProcessor ? { processor: this.imageProcessor } : {},
					);
		const budgeted = applyImageBudget([...normalized] satisfies AgentMessage[], {
			highWatermarkBytes: this.settings?.getImageRequestHighWatermarkBytes?.(),
			lowWatermarkBytes: this.settings?.getImageRequestLowWatermarkBytes?.(),
		}).filter(isRuntimeMessage);
		return this.settings?.getBlockImages?.() === true ? budgeted.map(blockImages) : budgeted;
	}
}

function isRuntimeMessage(message: AgentMessage): message is Message {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

function blockImages(message: Message): Message {
	if (message.role !== "user" && message.role !== "toolResult") return message;
	if (!Array.isArray(message.content) || !message.content.some(({ type }) => type === "image")) return message;
	const content = message.content
		.map((item): TextContent => (item.type === "image" ? { type: "text", text: "Image reading is disabled." } : item))
		.filter(
			(item, index, items) =>
				item.text !== "Image reading is disabled." ||
				index === 0 ||
				items[index - 1].text !== "Image reading is disabled.",
		);
	return { ...message, content };
}
