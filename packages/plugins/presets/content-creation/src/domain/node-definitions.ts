import type { ContentNodeData, ContentNodeKind } from "./model";

export type ContentNodeCategory = "input" | "generation" | "resource" | "output";
export type ContentPortDataType = "text" | "image" | "video" | "audio" | "media" | "content";
export type ContentNodePropertyEditor = "text" | "textarea" | "select" | "number" | "model";

export interface ContentPortDefinition {
	id: string;
	labelKey: string;
	dataType: ContentPortDataType;
	multiple?: boolean;
}

export interface ContentNodePropertyOption {
	value: string;
	labelKey: string;
}

export interface ContentNodePropertyDefinition {
	key: keyof ContentNodeData;
	labelKey: string;
	editor: ContentNodePropertyEditor;
	placeholderKey?: string;
	options?: readonly ContentNodePropertyOption[];
	min?: number;
	max?: number;
	step?: number;
}

export interface ContentNodeDefinition {
	kind: ContentNodeKind;
	category: ContentNodeCategory;
	labelKey: string;
	descriptionKey: string;
	accent: "neutral" | "violet" | "blue" | "amber" | "green";
	defaultData: ContentNodeData;
	inputs: readonly ContentPortDefinition[];
	outputs: readonly ContentPortDefinition[];
	properties: readonly ContentNodePropertyDefinition[];
}

const LABEL_PROPERTY: ContentNodePropertyDefinition = {
	key: "label",
	labelKey: "nodeEditor.label",
	editor: "text",
};

const PROMPT_PROPERTY: ContentNodePropertyDefinition = {
	key: "prompt",
	labelKey: "nodeEditor.prompt",
	editor: "textarea",
	placeholderKey: "nodeEditor.prompt.placeholder",
};

const ASPECT_RATIO_PROPERTY: ContentNodePropertyDefinition = {
	key: "aspectRatio",
	labelKey: "nodeEditor.aspectRatio",
	editor: "select",
	options: ["1:1", "16:9", "9:16", "4:3", "3:4"].map((value) => ({
		value,
		labelKey: `option.aspectRatio.${value}`,
	})),
};

export const CONTENT_NODE_DEFINITIONS: readonly ContentNodeDefinition[] = [
	{
		kind: "prompt",
		category: "input",
		labelKey: "node.kind.prompt",
		descriptionKey: "node.description.prompt",
		accent: "neutral",
		defaultData: {},
		inputs: [],
		outputs: [{ id: "text", labelKey: "port.text", dataType: "text", multiple: true }],
		properties: [LABEL_PROPERTY, PROMPT_PROPERTY],
	},
	{
		kind: "image-generator",
		category: "generation",
		labelKey: "node.kind.image-generator",
		descriptionKey: "node.description.image-generator",
		accent: "violet",
		defaultData: { aspectRatio: "1:1", quality: "standard", providerId: "openai", modelId: "gpt-image-2" },
		inputs: [
			{ id: "prompt", labelKey: "port.prompt", dataType: "text" },
			{ id: "reference", labelKey: "port.imageReference", dataType: "image", multiple: true },
		],
		outputs: [{ id: "image", labelKey: "port.image", dataType: "image", multiple: true }],
		properties: [
			PROMPT_PROPERTY,
			{ key: "modelId", labelKey: "nodeEditor.model", editor: "model" },
			ASPECT_RATIO_PROPERTY,
			{
				key: "quality",
				labelKey: "nodeEditor.quality",
				editor: "select",
				options: ["standard", "hd", "ultra"].map((value) => ({ value, labelKey: `option.quality.${value}` })),
			},
		],
	},
	{
		kind: "video-generator",
		category: "generation",
		labelKey: "node.kind.video-generator",
		descriptionKey: "node.description.video-generator",
		accent: "blue",
		defaultData: { aspectRatio: "16:9", duration: 5, resolution: "720p" },
		inputs: [
			{ id: "prompt", labelKey: "port.prompt", dataType: "text" },
			{ id: "image", labelKey: "port.imageReference", dataType: "image", multiple: true },
			{ id: "video", labelKey: "port.videoReference", dataType: "video", multiple: true },
		],
		outputs: [{ id: "video", labelKey: "port.video", dataType: "video", multiple: true }],
		properties: [
			PROMPT_PROPERTY,
			{ key: "modelId", labelKey: "nodeEditor.model", editor: "model" },
			ASPECT_RATIO_PROPERTY,
			{ key: "duration", labelKey: "nodeEditor.duration", editor: "number", min: 1, max: 60, step: 1 },
			{
				key: "resolution",
				labelKey: "nodeEditor.resolution",
				editor: "select",
				options: ["480p", "720p", "1080p", "4k"].map((value) => ({
					value,
					labelKey: `option.resolution.${value}`,
				})),
			},
		],
	},
	{
		kind: "asset",
		category: "resource",
		labelKey: "node.kind.asset",
		descriptionKey: "node.description.asset",
		accent: "amber",
		defaultData: {},
		inputs: [],
		outputs: [{ id: "media", labelKey: "port.media", dataType: "media", multiple: true }],
		properties: [LABEL_PROPERTY],
	},
	{
		kind: "output",
		category: "output",
		labelKey: "node.kind.output",
		descriptionKey: "node.description.output",
		accent: "green",
		defaultData: {},
		inputs: [{ id: "content", labelKey: "port.content", dataType: "content", multiple: true }],
		outputs: [],
		properties: [LABEL_PROPERTY],
	},
];

const definitionByKind = new Map(CONTENT_NODE_DEFINITIONS.map((definition) => [definition.kind, definition]));

export function getContentNodeDefinition(kind: ContentNodeKind): ContentNodeDefinition {
	const definition = definitionByKind.get(kind);
	if (!definition) throw new Error(`content node definition not found: ${kind}`);
	return definition;
}

export function createDefaultContentNodeData(kind: ContentNodeKind, data?: ContentNodeData): ContentNodeData {
	return { ...getContentNodeDefinition(kind).defaultData, ...data };
}
