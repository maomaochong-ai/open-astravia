import type { PluginMediaProviderSubmitRequest } from "@vetta-org/plugin-sdk";

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

export function isCompatibleMinimaxPrompt(value: unknown): value is ComfyPrompt {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prompt = value as ComfyPrompt;
	return ["LoadImage", "MiniMaxH3ImageToVideo", "SaveVideo"].every(
		(classType) => nodesByClass(prompt, classType).length > 0,
	);
}

export function adaptMinimaxWorkflow(
	template: ComfyPrompt,
	request: GenerateRequest,
	uploadedImage: string,
	seed: number,
): AdaptedWorkflow {
	const prompt = structuredClone(template);
	const [, loadImage] = requiredNode(prompt, "LoadImage");
	const [, generator] = requiredNode(prompt, "MiniMaxH3ImageToVideo");
	const [outputNodeId] = requiredNode(prompt, "SaveVideo");
	loadImage.inputs.image = uploadedImage;
	generator.inputs.prompt = request.prompt;

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
	return { prompt, outputNodeId };
}
