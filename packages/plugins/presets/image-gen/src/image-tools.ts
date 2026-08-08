import type {
	PluginContext,
	PluginImageRef,
	PluginMediaArtifact,
	PluginMediaGenerationMode,
	PluginMediaInput,
	PluginStoredBlobRef,
} from "@vetta-org/plugin-sdk";
import { PluginMediaError } from "@vetta-org/plugin-sdk";
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
const BUILTIN_VETTA_PROVIDER_ID = "desktop-app:vetta";

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
function mediaFailure(error: PluginMediaError): Record<string, unknown> {
	const message = ((): string => {
		switch (error.code) {
			case "quota-exhausted":
				return "The user's Vetta subscription quota is used up, so no image can be produced right now. Tell the user their image quota is exhausted and when it resets, and do not retry.";
			case "not-entitled":
				return "The user's current Vetta plan does not include image generation. Tell the user to upgrade their subscription, and do not retry.";
			case "provider-unavailable":
			case "operation-unsupported":
				return "No installed media provider can perform this image operation. Tell the user that image generation is unavailable, and do not retry.";
			default:
				return `Image generation failed: ${error.message}`;
		}
	})();
	return { ok: false, retryable: false, error: message };
}

function dimensionsFromSize(size: string | undefined): { width: number; height: number } | undefined {
	const match = /^(\d+)x(\d+)$/.exec(size?.trim() ?? "");
	if (!match) return undefined;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

async function findProvider(ctx: PluginContext, mode: PluginMediaGenerationMode): Promise<string> {
	const providers = (await ctx.media.listProviders()).filter((candidate) =>
			candidate.capabilities.some(
				(capability) =>
					capability.operation === "generate" &&
					capability.kind === "image" &&
					capability.modes.includes(mode),
			),
		);
	const provider =
		providers.find((candidate) => candidate.id === BUILTIN_VETTA_PROVIDER_ID) ?? providers[0];
	if (!provider) {
		throw new PluginMediaError({
			code: "provider-unavailable",
			message: `No media provider supports ${mode}`,
			retryable: false,
		});
	}
	return provider.id;
}

function requireImageArtifact(artifact: PluginMediaArtifact | undefined): PluginMediaArtifact {
	if (!artifact || artifact.kind !== "image") {
		throw new PluginMediaError({
			code: "provider-failed",
			message: "Media provider did not return an image artifact",
			retryable: false,
		});
	}
	return artifact;
}

async function generateThroughMedia(
	ctx: PluginContext,
	input: { prompt: string; size?: string },
	source?: PluginMediaInput,
): Promise<PluginStoredBlobRef> {
	const mode = source ? "image-to-image" : "text-to-image";
	const submitted = await ctx.media.submit({
		operation: "generate",
		providerId: await findProvider(ctx, mode),
		kind: "image",
		mode,
		prompt: input.prompt,
		dimensions: dimensionsFromSize(input.size),
		inputs: source ? [source] : [],
	});
	const job = await ctx.jobs.wait(submitted, { pollIntervalMs: 1_000 });
	if (job.status === "failed" && job.error) throw new PluginMediaError(job.error);
	if (job.status === "cancelled") {
		throw new PluginMediaError({ code: "cancelled", message: "Image generation was cancelled", retryable: false });
	}
	const artifact = requireImageArtifact(job.artifacts[0]);
	try {
		const saved = await ctx.artifacts.persist(artifact, { type: "plugin-blob" });
		if (saved.type !== "plugin-blob") throw new Error("Generated image was not saved to plugin storage");
		return { id: saved.blobId, url: saved.url, mimeType: saved.mimeType };
	} finally {
		await ctx.artifacts.release(artifact).catch(() => undefined);
	}
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
			let blob: PluginStoredBlobRef;
			try {
				blob = await generateThroughMedia(ctx, trigger.input);
			} catch (error) {
				if (error instanceof PluginMediaError) return mediaFailure(error);
				throw error;
			}
			const image = await repository.persist(blob, { sessionId: session.id });
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
		handler: async ({ session, trigger }) => {
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
			const source: PluginMediaInput | null = generatedSource
				? {
						kind: "image",
						mimeType: generatedSource.mimeType,
						source: { type: "plugin-blob", blobId: generatedSource.id },
					}
				: input.sourceImagePath
					? { kind: "image", source: { type: "workspace-file", path: input.sourceImagePath } }
					: null;
			if (!source) throw new Error("Image source was not found");
			let blob: PluginStoredBlobRef;
			try {
				blob = await generateThroughMedia(ctx, {
					prompt: input.prompt,
					size: input.size,
				}, source);
			} catch (error) {
				if (error instanceof PluginMediaError) return mediaFailure(error);
				throw error;
			}
			const sourceLineage = input.sourceImageId
				? await repository.lineage(input.sourceImageId)
				: [];
			const rootId = sourceLineage[0]?.rootId;
			const image = await repository.persist(blob, {
				rootId,
				parent: input.sourceImageId,
				sessionId: session.id,
			});
			ctx.ui.openActivityTab(HISTORY_TAB_ID);
			return result("edited", [image]);
		},
	});
}
