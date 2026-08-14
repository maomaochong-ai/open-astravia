import type { ContentProjectCommand } from "./commands";
import type { ContentProjectFile } from "./document-schema";
import { hydrateContentProject } from "./hydrate-project";
import { serializeContentProject, serializeContentProjectRuntime } from "./persistence";
import type { ContentProjectDocument } from "./types";

export const CONTENT_PROJECT_HISTORY_LIMIT = 100;

export type ContentHistoryOrigin = "ui" | "agent";

export type ContentHistoryActionKind =
	| "workflow.edit"
	| "node.add"
	| "node.delete"
	| "node.duplicate"
	| "node.move"
	| "node.resize"
	| "node.edit"
	| "node.lock"
	| "edge.connect"
	| "edge.delete"
	| "asset.import"
	| "timeline.edit"
	| "agent.edit"
	| "mixed";

export interface ContentHistoryAction {
	kind: ContentHistoryActionKind;
	count: number;
}

export interface ContentHistoryMetadata {
	record?: boolean;
	origin?: ContentHistoryOrigin;
	action?: ContentHistoryAction;
	groupId?: string;
}

export interface ContentHistoryFrame {
	id: string;
	snapshot: ContentProjectFile;
	action: ContentHistoryAction;
	origin: ContentHistoryOrigin;
	createdAt: string;
	groupId?: string;
}

export interface ContentProjectHistoryState {
	past: ContentHistoryFrame[];
	future: ContentHistoryFrame[];
}

export interface ContentProjectHistoryView {
	canUndo: boolean;
	canRedo: boolean;
	undoAction?: ContentHistoryAction;
	redoAction?: ContentHistoryAction;
}

export class ContentProjectHistoryConflictError extends Error {
	constructor(readonly activeNodeIds: readonly string[]) {
		super(`history restore would remove active generation nodes: ${activeNodeIds.join(", ")}`);
	}
}

export function createContentProjectHistoryState(): ContentProjectHistoryState {
	return { past: [], future: [] };
}

export function captureContentProjectHistorySnapshot(project: ContentProjectDocument): ContentProjectFile {
	return serializeContentProject(project);
}

export function contentProjectHistorySnapshotsEqual(
	left: ContentProjectFile,
	right: ContentProjectFile,
): boolean {
	return JSON.stringify(toEditableHistoryProjection(left)) === JSON.stringify(toEditableHistoryProjection(right));
}

export function recordContentProjectHistory(
	history: ContentProjectHistoryState,
	before: ContentProjectFile,
	after: ContentProjectFile,
	commands: readonly ContentProjectCommand[],
	metadata: ContentHistoryMetadata = {},
	now = new Date().toISOString(),
): ContentProjectHistoryState {
	if (metadata.record === false) return history;
	if (contentProjectHistorySnapshotsEqual(before, after)) return history;
	const groupId = metadata.groupId?.trim() || undefined;
	const action = metadata.action ?? describeContentProjectCommands(commands);
	const origin = metadata.origin ?? "ui";
	const previous = history.past.at(-1);
	if (groupId && previous?.groupId === groupId) {
		return {
			past: [
				...history.past.slice(0, -1),
				{
					...previous,
					action,
					origin,
					createdAt: now,
				},
			],
			future: [],
		};
	}
	const frame: ContentHistoryFrame = {
		id: crypto.randomUUID(),
		snapshot: before,
		action,
		origin,
		createdAt: now,
		...(groupId ? { groupId } : {}),
	};
	return {
		past: [...history.past, frame].slice(-CONTENT_PROJECT_HISTORY_LIMIT),
		future: [],
	};
}

export function undoContentProjectHistory(
	project: ContentProjectDocument,
	history: ContentProjectHistoryState,
	now = new Date().toISOString(),
): { project: ContentProjectDocument; history: ContentProjectHistoryState } | null {
	const frame = history.past.at(-1);
	if (!frame) return null;
	const current = captureContentProjectHistorySnapshot(project);
	return {
		project: restoreContentProjectHistorySnapshot(project, frame.snapshot, now),
		history: {
			past: history.past.slice(0, -1),
			future: [
				...history.future,
				{
					...frame,
					id: crypto.randomUUID(),
					snapshot: current,
					createdAt: now,
				},
			].slice(-CONTENT_PROJECT_HISTORY_LIMIT),
		},
	};
}

export function redoContentProjectHistory(
	project: ContentProjectDocument,
	history: ContentProjectHistoryState,
	now = new Date().toISOString(),
): { project: ContentProjectDocument; history: ContentProjectHistoryState } | null {
	const frame = history.future.at(-1);
	if (!frame) return null;
	const current = captureContentProjectHistorySnapshot(project);
	return {
		project: restoreContentProjectHistorySnapshot(project, frame.snapshot, now),
		history: {
			past: [
				...history.past,
				{
					...frame,
					id: crypto.randomUUID(),
					snapshot: current,
					createdAt: now,
				},
			].slice(-CONTENT_PROJECT_HISTORY_LIMIT),
			future: history.future.slice(0, -1),
		},
	};
}

export function restoreContentProjectHistorySnapshot(
	current: ContentProjectDocument,
	snapshot: ContentProjectFile,
	now = new Date().toISOString(),
): ContentProjectDocument {
	const snapshotNodeIds = new Set(snapshot.nodes.map((node) => node.id));
	const activeNodeIds = current.jobs
		.filter((job) => (job.status === "queued" || job.status === "running") && !snapshotNodeIds.has(job.nodeId))
		.map((job) => job.nodeId);
	if (activeNodeIds.length > 0) throw new ContentProjectHistoryConflictError(activeNodeIds);

	const currentNodes = new Map(current.graph.nodes.map((node) => [node.id, node]));
	const runtime = serializeContentProjectRuntime(current);
	const restored = hydrateContentProject(snapshot, current.cwd, runtime);
	const snapshotNodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
	for (const node of restored.graph.nodes) {
		const currentNode = currentNodes.get(node.id);
		if (currentNode) {
			node.status = currentNode.status;
			const { assetId: _snapshotAssetId, ...editableData } = node.data;
			node.data = {
				...editableData,
				...(currentNode.data.assetId ? { assetId: currentNode.data.assetId } : {}),
			};
			continue;
		}
		const snapshotNode = snapshotNodes.get(node.id);
		if (snapshotNode && "result" in snapshotNode && snapshotNode.result.state === "available") {
			node.status = "succeeded";
		}
	}

	const assets = new Map(restored.assets.map((asset) => [asset.id, asset]));
	for (const asset of current.assets) {
		if (asset.filePath) assets.set(asset.id, structuredClone(asset));
	}
	const restoredNodeIds = new Set(restored.graph.nodes.map((node) => node.id));
	return {
		...restored,
		revision: current.revision + 1,
		updatedAt: now,
		assets: [...assets.values()],
		jobs: current.jobs.filter((job) => restoredNodeIds.has(job.nodeId)),
	};
}

export function getContentProjectHistoryView(history: ContentProjectHistoryState): ContentProjectHistoryView {
	const undoAction = history.past.at(-1)?.action;
	const redoAction = history.future.at(-1)?.action;
	return {
		canUndo: Boolean(undoAction),
		canRedo: Boolean(redoAction),
		...(undoAction ? { undoAction } : {}),
		...(redoAction ? { redoAction } : {}),
	};
}

export function describeContentProjectCommands(commands: readonly ContentProjectCommand[]): ContentHistoryAction {
	const relevant = commands.filter((command) => !command.type.startsWith("job."));
	if (relevant.some((command) => command.type === "asset.add")) {
		return { kind: "asset.import", count: relevant.filter((command) => command.type === "asset.add").length };
	}
	const kinds = new Set(relevant.map((command) => historyActionKind(command.type)));
	if (kinds.size === 1) return { kind: kinds.values().next().value ?? "mixed", count: relevant.length };
	return { kind: "mixed", count: relevant.length };
}

function historyActionKind(type: ContentProjectCommand["type"]): ContentHistoryActionKind {
	if (type === "workflow.update") return "workflow.edit";
	if (type === "node.add") return "node.add";
	if (type === "node.delete") return "node.delete";
	if (type === "node.duplicate") return "node.duplicate";
	if (type === "node.move" || type === "node.layout") return "node.move";
	if (type === "node.resize") return "node.resize";
	if (type === "node.lock") return "node.lock";
	if (type === "edge.connect") return "edge.connect";
	if (type === "edge.delete") return "edge.delete";
	if (type.startsWith("timeline.")) return "timeline.edit";
	return "node.edit";
}

function toEditableHistoryProjection(snapshot: ContentProjectFile): unknown {
	return {
		format: snapshot.format,
		schemaVersion: snapshot.schemaVersion,
		projectId: snapshot.projectId,
		workflow: snapshot.workflow,
		nodes: snapshot.nodes.map((node) =>
			"result" in node ? { ...node, result: { state: "not-generated" as const } } : node,
		),
		assets: snapshot.assets.filter((asset) => asset.source.storage === "managed"),
		view: snapshot.view,
		timeline: snapshot.timeline,
	};
}
