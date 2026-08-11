import type { PluginMediaErrorCode } from "@vetta-org/plugin-sdk";

export const CONTENT_CREATION_FORMAT = "vetta.content-workflow" as const;
export const CONTENT_CREATION_SCHEMA_VERSION = 6 as const;
export const CONTENT_CREATION_RUNTIME_SCHEMA_VERSION = 1 as const;

export type ContentNodeKind = "prompt" | "image-generator" | "video-generator" | "asset" | "output";
export type ContentNodeStatus = "idle" | "queued" | "running" | "succeeded" | "failed";
export type AssetKind = "image" | "video" | "audio";
export type TrackKind = "video" | "audio";
export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ContentNodeLayoutOwnership = "automatic" | "user";

export interface ContentWorkflowDeliverable {
	type: AssetKind | "text" | "content";
	fromNode: string;
	description: string;
}

export interface ContentWorkflow {
	title: string;
	objective: string;
	deliverables: ContentWorkflowDeliverable[];
}

export interface CanvasPosition {
	x: number;
	y: number;
}

export interface ContentNodeData {
	prompt?: string;
	promptDocument?: ContentPromptDocument;
	promptOptimization?: ContentPromptOptimization;
	assetId?: string;
	assetIds?: string[];
	aspectRatio?: string;
	quality?: string;
	duration?: number;
	resolution?: string;
	providerId?: string;
	modelId?: string;
	modeId?: string;
	promptSourceNodeId?: string | null;
	inputs?: ContentNodeInputBinding[];
}

export interface ContentPromptOptimization {
	text: string;
	modelKey: string;
	createdAt: string;
}

export interface ContentPromptDocument {
	version: 1;
	segments: ContentPromptSegment[];
}

export type ContentPromptSegment =
	| { type: "text"; text: string }
	| { type: "asset-reference"; bindingId: string }
	| { type: "prompt-reference"; sourceNodeId: string };

export interface ContentNodeInputBinding {
	id: string;
	assetId: string;
	slotId: string;
	sourceNodeId?: string;
}

export interface ContentNode {
	id: string;
	kind: ContentNodeKind;
	/** Persisted, user-facing node identity. Older in-memory test fixtures may omit it. */
	name?: string;
	/** Semantic role in the workflow, used by people and AI independently of canvas layout. */
	purpose?: string;
	position: CanvasPosition;
	width?: number;
	height?: number;
	locked?: boolean;
	/** Automatic nodes may be repositioned by incremental graph layout; user nodes remain stable unless topology requires space. */
	layoutOwnership?: ContentNodeLayoutOwnership;
	status: ContentNodeStatus;
	data: ContentNodeData;
}

export interface ContentEdge {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
	/** Semantic generation input role. Persisted through MediaInput.role, not canvas layout. */
	role?: string;
}

export interface ContentAsset {
	id: string;
	/** Plugin-private storage ID for user-imported source material. */
	blobId?: string;
	/** Workspace-relative path for generated material, for example `output/image-ab12cd34.png`. */
	filePath?: string;
	kind: AssetKind;
	name: string;
	mimeType: string;
	/** Runtime-only media URL. Project persistence stores blobId or filePath instead. */
	previewUrl?: string;
	duration?: number;
	width?: number;
	height?: number;
	createdAt: string;
}

export interface GenerationJob {
	id: string;
	nodeId: string;
	provider: string;
	model: string;
	status: GenerationJobStatus;
	progress: number;
	outputAssetId?: string;
	execution?: {
		kind: "host-job";
		jobId: string;
		outputKind: "image" | "video";
	};
	assetId?: string;
	error?: string;
	errorCode?: PluginMediaErrorCode;
	createdAt: string;
	updatedAt: string;
}

export interface TimelineClip {
	id: string;
	trackId: string;
	sourceNodeId?: string;
	assetId?: string;
	start: number;
	duration: number;
	sourceIn: number;
	speed: number;
}

export interface TimelineTrack {
	id: string;
	kind: TrackKind;
	clips: TimelineClip[];
}

export interface ContentProjectDocument {
	schemaVersion: typeof CONTENT_CREATION_SCHEMA_VERSION;
	revision: number;
	projectId: string;
	cwd: string | null;
	createdAt: string;
	updatedAt: string;
	workflow: ContentWorkflow;
	graph: {
		nodes: ContentNode[];
		edges: ContentEdge[];
	};
	assets: ContentAsset[];
	jobs: GenerationJob[];
	timeline: {
		tracks: TimelineTrack[];
	};
}

export interface ContentProjectRuntimeDocument {
	schemaVersion: typeof CONTENT_CREATION_RUNTIME_SCHEMA_VERSION;
	projectId: string;
	updatedAt: string;
	jobs: GenerationJob[];
	nodeStatuses: Record<string, ContentNodeStatus>;
}

export function createContentProject(cwd: string | null, now = new Date().toISOString()): ContentProjectDocument {
	return {
		schemaVersion: CONTENT_CREATION_SCHEMA_VERSION,
		revision: 0,
		projectId: crypto.randomUUID(),
		cwd,
		createdAt: now,
		updatedAt: now,
		workflow: {
			title: "Untitled content workflow",
			objective: "",
			deliverables: [],
		},
		graph: { nodes: [], edges: [] },
		assets: [],
		jobs: [],
		timeline: {
			tracks: [
				{ id: "video-1", kind: "video", clips: [] },
				{ id: "audio-1", kind: "audio", clips: [] },
			],
		},
	};
}
