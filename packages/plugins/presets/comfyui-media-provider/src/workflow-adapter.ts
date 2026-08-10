import type { PluginMediaGenerationMode, PluginMediaProviderSubmitRequest } from "@vetta-org/plugin-sdk";

type GenerateRequest = Extract<PluginMediaProviderSubmitRequest, { operation: "generate" }>;

export interface ComfyPromptNode {
	class_type: string;
	inputs: Record<string, unknown>;
	_meta?: { title?: string };
}

export type ComfyPrompt = Record<string, ComfyPromptNode>;

export interface AdaptedWorkflow {
	prompt: ComfyPrompt;
	outputNodeId: string;
}

export interface UploadedMediaInput {
	id: string;
	role?: string;
	kind: "image" | "video" | "audio";
	path: string;
}

const ASPECT_RATIO_VALUES: Record<string, string> = {
	"1:1": "1:1 (Square)",
	"2:3": "2:3 (Portrait Photo)",
	"3:2": "3:2 (Photo)",
	"3:4": "3:4 (Portrait Standard)",
	"4:3": "4:3 (Standard)",
	"9:16": "9:16 (Portrait Widescreen)",
	"16:9": "16:9 (Widescreen)",
	"21:9": "21:9 (Ultrawide)",
};

function nodesByClass(prompt: ComfyPrompt, classType: string): Array<[string, ComfyPromptNode]> {
	return Object.entries(prompt).filter(([, node]) => node.class_type === classType);
}

function requiredNode(prompt: ComfyPrompt, classType: string): [string, ComfyPromptNode] {
	const node = nodesByClass(prompt, classType)[0];
	if (!node) throw new Error(`ComfyUI template is missing required node: ${classType}`);
	return node;
}

function isPrompt(value: unknown): value is ComfyPrompt {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isCompatibleMinimaxPrompt(value: unknown, mode: PluginMediaGenerationMode): value is ComfyPrompt {
	if (!isPrompt(value)) return false;
	const generatorClass = mode === "reference-to-video" ? "MiniMaxH3ReferenceToVideo" : "MiniMaxH3ImageToVideo";
	return nodesByClass(value, generatorClass).length > 0 && nodesByClass(value, "SaveVideo").length > 0;
}

function linkedNode(prompt: ComfyPrompt, value: unknown): [string, ComfyPromptNode] | undefined {
	if (!Array.isArray(value) || typeof value[0] !== "string") return undefined;
	const node = prompt[value[0]];
	return node ? [value[0], node] : undefined;
}

function nextNodeId(prompt: ComfyPrompt, prefix: string): string {
	for (let index = 1; ; index += 1) {
		const id = `vetta_${prefix}_${index}`;
		if (!prompt[id]) return id;
	}
}

function setLoaderPath(node: ComfyPromptNode, path: string, kind: UploadedMediaInput["kind"]): void {
	const preferredKeys =
		kind === "image" ? ["image"] : kind === "video" ? ["video", "file", "video_path"] : ["audio", "file", "audio_path"];
	const key = preferredKeys.find((candidate) => candidate in node.inputs) ?? preferredKeys[0];
	node.inputs[key] = path;
}

function loaderClass(kind: UploadedMediaInput["kind"]): string {
	if (kind === "image") return "LoadImage";
	if (kind === "video") return "LoadVideo";
	return "LoadAudio";
}

function cloneOrCreateLoader(
	prompt: ComfyPrompt,
	kind: UploadedMediaInput["kind"],
	path: string,
	prototype?: ComfyPromptNode,
): [string, ComfyPromptNode] {
	if (!prototype && kind !== "image") {
		throw new Error(`ComfyUI reference template needs a connected ${kind} loader before Vetta can add ${kind} references`);
	}
	const id = nextNodeId(prompt, `${kind}_input`);
	const node = prototype
		? structuredClone(prototype)
		: { class_type: loaderClass(kind), inputs: { image: path } };
	setLoaderPath(node, path, kind);
	prompt[id] = node;
	return [id, node];
}

function connectFrame(
	prompt: ComfyPrompt,
	generator: ComfyPromptNode,
	name: "first_frame" | "last_frame",
	input: UploadedMediaInput | undefined,
	claimedLoaderIds: Set<string>,
): void {
	if (!input) {
		delete generator.inputs[name];
		return;
	}
	let loader = linkedNode(prompt, generator.inputs[name]);
	if (!loader) {
		loader = nodesByClass(prompt, "LoadImage").find(([id]) => !claimedLoaderIds.has(id));
	}
	if (!loader) loader = cloneOrCreateLoader(prompt, "image", input.path);
	claimedLoaderIds.add(loader[0]);
	setLoaderPath(loader[1], input.path, "image");
	generator.inputs[name] = [loader[0], 0];
}

function referenceInputName(role: string, index: number): string {
	if (role === "referenceImages") return `ref_images.ref_image_${index}`;
	if (role === "referenceVideos") return `ref_videos.ref_video_${index}`;
	return `ref_audios.ref_audio_${index}`;
}

function referenceInputKind(role: string): UploadedMediaInput["kind"] {
	if (role === "referenceImages") return "image";
	if (role === "referenceVideos") return "video";
	return "audio";
}

function connectReferenceGroup(
	prompt: ComfyPrompt,
	generator: ComfyPromptNode,
	role: "referenceImages" | "referenceVideos" | "referenceAudios",
	inputs: readonly UploadedMediaInput[],
): void {
	const kind = referenceInputKind(role);
	const prefix = referenceInputName(role, 0).replace(/0$/, "");
	const existingNames = Object.keys(generator.inputs).filter((name) => name.startsWith(prefix)).sort();
	const existingLoaders = existingNames.map((name) => linkedNode(prompt, generator.inputs[name]));
	const prototype = existingLoaders.find((loader) => loader)?.[1];
	for (const name of existingNames) delete generator.inputs[name];
	if (role === "referenceVideos") {
		for (const name of Object.keys(generator.inputs)) {
			if (name.startsWith("ref_video_audios.ref_video_audio_")) delete generator.inputs[name];
		}
	}
	inputs.forEach((input, index) => {
		let loader = existingLoaders[index];
		if (!loader) loader = cloneOrCreateLoader(prompt, kind, input.path, prototype);
		setLoaderPath(loader[1], input.path, kind);
		generator.inputs[referenceInputName(role, index)] = [loader[0], 0];
		if (role === "referenceVideos") {
			generator.inputs[`ref_video_audios.ref_video_audio_${index}`] = [loader[0], 1];
		}
	});
}

function applyCommonSettings(prompt: ComfyPrompt, request: GenerateRequest, seed: number): void {
	const resolution = nodesByClass(prompt, "ResolutionSelector")[0]?.[1];
	if (request.aspectRatio && resolution) {
		resolution.inputs.aspect_ratio = ASPECT_RATIO_VALUES[request.aspectRatio] ?? request.aspectRatio;
	}
	const duration = nodesByClass(prompt, "PrimitiveFloat").find(([, node]) =>
		node._meta?.title?.toLowerCase().includes("duration"),
	)?.[1];
	if (request.durationSeconds && duration) duration.inputs.value = request.durationSeconds;
	const noise = nodesByClass(prompt, "RandomNoise")[0]?.[1];
	if (noise) noise.inputs.noise_seed = seed;
}

export function adaptMinimaxWorkflow(
	template: ComfyPrompt,
	request: GenerateRequest,
	uploadedInputs: readonly UploadedMediaInput[],
	seed: number,
): AdaptedWorkflow {
	const prompt = structuredClone(template);
	const [outputNodeId] = requiredNode(prompt, "SaveVideo");
	if (request.mode === "reference-to-video") {
		const [, generator] = requiredNode(prompt, "MiniMaxH3ReferenceToVideo");
		generator.inputs.prompt = request.prompt;
		connectReferenceGroup(prompt, generator, "referenceImages", uploadedInputs.filter((input) => input.role === "referenceImages"));
		connectReferenceGroup(prompt, generator, "referenceVideos", uploadedInputs.filter((input) => input.role === "referenceVideos"));
		connectReferenceGroup(prompt, generator, "referenceAudios", uploadedInputs.filter((input) => input.role === "referenceAudios"));
	} else {
		const [, generator] = requiredNode(prompt, "MiniMaxH3ImageToVideo");
		generator.inputs.prompt = request.prompt;
		const claimed = new Set<string>();
		connectFrame(prompt, generator, "first_frame", uploadedInputs.find((input) => input.role === "firstFrame"), claimed);
		connectFrame(prompt, generator, "last_frame", uploadedInputs.find((input) => input.role === "lastFrame"), claimed);
	}
	applyCommonSettings(prompt, request, seed);
	return { prompt, outputNodeId };
}
