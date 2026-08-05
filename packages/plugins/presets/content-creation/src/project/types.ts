export const CONTENT_CREATION_SCHEMA_VERSION = 1 as const;

export type ContentNodeKind = "prompt" | "image-generator" | "video-generator" | "asset" | "output";
export type ContentNodeStatus = "idle" | "queued" | "running" | "succeeded" | "failed";
export type AssetKind = "image" | "video" | "audio";
export type TrackKind = "video" | "audio";
export type GenerationJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface CanvasPosition {
	x: number;
	y: number;
}

export interface ContentNodeData {
	label?: string;
	prompt?: string;
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

export interface ContentNodeInputBinding {
	id: string;
	assetId: string;
	slotId: string;
	sourceNodeId?: string;
}

export interface ContentNode {
	id: string;
	kind: ContentNodeKind;
	position: CanvasPosition;
	width?: number;
	height?: number;
	locked?: boolean;
	status: ContentNodeStatus;
	data: ContentNodeData;
}

export interface ContentEdge {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
}

export interface ContentAsset {
	id: string;
	kind: AssetKind;
	name: string;
	mimeType: string;
	url: string;
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
	assetId?: string;
	error?: string;
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

export function createContentProject(cwd: string | null, now = new Date().toISOString()): ContentProjectDocument {
	return {
		schemaVersion: CONTENT_CREATION_SCHEMA_VERSION,
		revision: 0,
		projectId: crypto.randomUUID(),
		cwd,
		createdAt: now,
		updatedAt: now,
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
