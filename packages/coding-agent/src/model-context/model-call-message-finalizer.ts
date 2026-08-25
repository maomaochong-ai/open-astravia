import type { AgentMessage } from "@vetta/agent-core";
import type { Message, TextContent } from "@vetta/ai";
import type {
	RuntimeConfigurationSnapshotLease,
	RuntimeConfigurationSnapshotSource,
} from "@vetta/runtime-core/configuration";
import type {
	ModelCallMessageFinalizationInput,
	ModelCallMessageFinalizer,
	RuntimeSnapshotAcquireContext,
} from "@vetta/runtime-core/kernel";
import { CODING_IMAGE_CONFIGURATION, type CodingImageConfiguration } from "@vetta/runtime-tools";
import { applyImageBudget } from "./image-budget.js";
import {
	type ModelInputImageProcessor,
	normalizeModelInputImages,
	resolveModelInputImageProcessor,
} from "./image-normalization.js";
import type { CodingAgentLegacyImageSettingsSource } from "./image-settings-source.js";

export type CodingAgentImageSettingsSource = CodingAgentLegacyImageSettingsSource;

/** 在最终模型调用边界应用动态图片预算与全局禁图语义。 */
export class CodingAgentModelCallMessageFinalizer implements ModelCallMessageFinalizer {
	constructor(
		private readonly settings?: CodingAgentImageSettingsSource,
		private readonly imageProcessor?: ModelInputImageProcessor,
		private readonly configurationSource?: RuntimeConfigurationSnapshotSource,
		private readonly boundConfiguration?: CodingImageConfiguration,
		private readonly configurationLease?: RuntimeConfigurationSnapshotLease,
	) {}

	bindForTurn(context: RuntimeSnapshotAcquireContext): ModelCallMessageFinalizer {
		context.signal.throwIfAborted();
		if (this.configurationSource) {
			const lease = this.configurationSource.acquire({
				scopeId: context.sessionId,
				bindingId: context.operationId,
				signal: context.signal,
			});
			const configuration = lease.snapshot.read(CODING_IMAGE_CONFIGURATION);
			if (!configuration) {
				void lease.release().catch(() => undefined);
				throw new Error("Coding Agent image Runtime Configuration is unavailable");
			}
			return new CodingAgentModelCallMessageFinalizer(
				undefined,
				this.imageProcessor,
				undefined,
				configuration,
				lease,
			);
		}
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

	releaseTurnBinding(): Promise<void> | undefined {
		return this.configurationLease?.release();
	}

	async finalize(input: ModelCallMessageFinalizationInput, signal: AbortSignal): Promise<readonly Message[]> {
		signal.throwIfAborted();
		const autoResize = this.boundConfiguration?.autoResize ?? this.settings?.getImageAutoResize?.();
		const normalized =
			autoResize === false
				? [...input.messages]
				: await normalizeModelInputImages(input.messages, signal, {
						processor: resolveModelInputImageProcessor(this.imageProcessor),
						resizeOptions: this.boundConfiguration?.resize,
					});
		const budgeted = applyImageBudget([...normalized] satisfies AgentMessage[], {
			highWatermarkBytes:
				this.boundConfiguration?.requestBudget.highWatermarkBytes ??
				this.settings?.getImageRequestHighWatermarkBytes?.(),
			lowWatermarkBytes:
				this.boundConfiguration?.requestBudget.lowWatermarkBytes ??
				this.settings?.getImageRequestLowWatermarkBytes?.(),
		}).filter(isRuntimeMessage);
		const block = this.boundConfiguration?.blockImages ?? this.settings?.getBlockImages?.();
		return block === true ? budgeted.map(blockImages) : budgeted;
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
