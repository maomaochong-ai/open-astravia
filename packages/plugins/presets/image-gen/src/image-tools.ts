import type { PluginContext, PluginImageRef } from "@vetta-org/plugin-sdk";
import { editImage, generateImage, IMAGE_ERROR_CODES, ImageGatewayError } from "./image-provider";
import type { ImageRepository } from "./image-repository";

interface GenerateImageInput {
	description?: string;
	prompt: string;
	size?: string;
}

interface EditImageInput extends GenerateImageInput {
	sourceImageId?: string;
	sourceImagePath?: string;
}

const PREVIEW_CARD_TYPE = "image-gen:preview";
const IMAGE_REFS_OPEN = "<vetta-images>";
const IMAGE_REFS_CLOSE = "</vetta-images>";
const SCOPE_USE = ["im-claw", "conversation", "project", "cli"] as const;
const HISTORY_TAB_ID = "history";

const sizeSchema = {
	type: "string",
	description:
		"Output dimensions as WIDTHxHEIGHT. Choose a size matching the requested aspect ratio; omit for 1024x1024.",
};

const generateParameters = {
	type: "object",
	properties: {
		description: { type: "string", description: "Short description of this tool call." },
		prompt: {
			type: "string",
			description:
				"Detailed English image prompt including subject, style, lighting, and composition.",
		},
		size: sizeSchema,
	},
	required: ["prompt"],
	additionalProperties: false,
};

const editParameters = {
	type: "object",
	properties: {
		description: { type: "string", description: "Short description of this tool call." },
		prompt: {
			type: "string",
			description: "Clear English instruction describing only the requested source-image changes.",
		},
		sourceImageId: {
			type: "string",
			description:
				`Generated image id from the latest ${IMAGE_REFS_OPEN} marker or the attached edit target.`,
		},
		sourceImagePath: {
			type: "string",
			description:
				"Absolute local image path. Use this instead of sourceImageId for uploaded or attached files.",
		},
		size: sizeSchema,
	},
	required: ["prompt"],
	additionalProperties: false,
};

function cards(images: PluginImageRef[]): unknown[] {
	if (images.length === 0) return [];
	return [
		{
			type: PREVIEW_CARD_TYPE,
			key: images[0]?.rootId,
			payload: { images },
		},
	];
}

function result(kind: "generated" | "edited", images: PluginImageRef[]): Record<string, unknown> {
	const marker =
		images.length > 0
			? `${IMAGE_REFS_OPEN}${JSON.stringify(images)}${IMAGE_REFS_CLOSE}`
			: "";
	return {
		ok: images.length > 0,
		summary:
			kind === "generated"
				? `Generated ${images.length} image(s). ${marker}`
				: `Edited ${images.length} image(s). ${marker}`,
		images,
		cards: cards(images),
	};
}

/**
 * 把网关的业务失败翻译成给模型看的结论。
 *
 * 这些不是异常而是常规业务分支：额度用尽、档位不含图像生成、服务端未配置模型，
 * 抛错只会让模型反复重试。`retryable: false` 明确告诉它换一条路（改成文字描述、
 * 或提示用户去升级订阅），而不是再打一次必然失败的请求。
 */
function gatewayFailure(error: ImageGatewayError): Record<string, unknown> {
	const message = ((): string => {
		switch (error.code) {
			case IMAGE_ERROR_CODES.QUOTA_EXHAUSTED:
				return "The user's Vetta subscription quota is used up, so no image can be produced right now. Tell the user their image quota is exhausted and when it resets, and do not retry.";
			case IMAGE_ERROR_CODES.MODEL_NOT_IN_PLAN:
			case IMAGE_ERROR_CODES.SUBSCRIPTION_INACTIVE:
				return "The user's current Vetta plan does not include image generation. Tell the user to upgrade their subscription, and do not retry.";
			case IMAGE_ERROR_CODES.NOT_CONFIGURED:
			case IMAGE_ERROR_CODES.SERVICE_DISABLED:
				return "Image generation is not available on this Vetta server. Tell the user to contact their administrator, and do not retry.";
			default:
				return `Image generation failed: ${error.message}`;
		}
	})();
	return { ok: false, retryable: false, error: message };
}

export function registerImageTools(ctx: PluginContext, repository: ImageRepository): void {
	ctx.agent.registerTool<GenerateImageInput>({
		id: "generate-image",
		name: "generate_image",
		label: "%tool.generate_image%",
		description:
			"Generate an actual new image from text. Use only when the user wants an image produced, then optimize the request into a detailed prompt.",
		parameters: generateParameters,
		timeoutMs: 300_000,
		scope_use: SCOPE_USE,
		handler: async ({ session, trigger }) => {
			let bytes: Awaited<ReturnType<typeof generateImage>>;
			try {
				bytes = await generateImage(ctx, trigger.input);
			} catch (error) {
				if (error instanceof ImageGatewayError) return gatewayFailure(error);
				throw error;
			}
			const image = await repository.persist(bytes, { sessionId: session.id });
			ctx.ui.openActivityTab(HISTORY_TAB_ID);
			return result("generated", [image]);
		},
	});

	ctx.agent.registerTool<EditImageInput>({
		id: "edit-image",
		name: "edit_image",
		label: "%tool.edit_image%",
		description:
			"Edit a specific existing image. Use sourceImageId for a previously generated image or sourceImagePath for a local file, never both.",
		parameters: editParameters,
		timeoutMs: 300_000,
		scope_use: SCOPE_USE,
		handler: async ({ host, session, trigger }) => {
			const input = trigger.input;
			if (!input.sourceImageId && !input.sourceImagePath) {
				return {
					ok: false,
					retryable: true,
					error: "Provide sourceImageId or sourceImagePath.",
				};
			}
			if (input.sourceImageId && input.sourceImagePath) {
				return {
					ok: false,
					retryable: true,
					error: "Provide exactly one image source.",
				};
			}
			const generatedSource = input.sourceImageId
				? await repository.read(input.sourceImageId)
				: null;
			const localSource = input.sourceImagePath
				? await host.fs.readBinaryFile(input.sourceImagePath)
				: null;
			const source = generatedSource ??
				(localSource
					? {
							data: localSource.data,
							mimeType: localSource.mimeType,
						}
					: null);
			if (!source) throw new Error("Image source was not found");
			let bytes: Awaited<ReturnType<typeof editImage>>;
			try {
				bytes = await editImage(ctx, {
					prompt: input.prompt,
					source,
					size: input.size,
				});
			} catch (error) {
				if (error instanceof ImageGatewayError) return gatewayFailure(error);
				throw error;
			}
			const sourceLineage = input.sourceImageId
				? await repository.lineage(input.sourceImageId)
				: [];
			const rootId = sourceLineage[0]?.rootId;
			const image = await repository.persist(bytes, {
				rootId,
				parent: input.sourceImageId,
				sessionId: session.id,
			});
			ctx.ui.openActivityTab(HISTORY_TAB_ID);
			return result("edited", [image]);
		},
	});
}
