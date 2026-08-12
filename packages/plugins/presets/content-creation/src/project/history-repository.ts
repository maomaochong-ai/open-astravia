import type { PluginStorageApi } from "@vetta-org/plugin-sdk";
import { isContentProjectFile } from "./persistence";
import type {
	ContentHistoryAction,
	ContentHistoryFrame,
	ContentProjectHistoryState,
} from "./history";
import { CONTENT_PROJECT_HISTORY_LIMIT } from "./history";
import type { ContentProjectFile } from "./document-schema";

const CONTENT_PROJECT_HISTORY_SCHEMA_VERSION = 1 as const;
const HISTORY_ACTION_KINDS = new Set<ContentHistoryAction["kind"]>([
	"workflow.edit",
	"node.add",
	"node.delete",
	"node.duplicate",
	"node.move",
	"node.resize",
	"node.edit",
	"node.lock",
	"edge.connect",
	"edge.delete",
	"asset.import",
	"timeline.edit",
	"agent.edit",
	"mixed",
]);

export interface StoredContentProjectHistory {
	schemaVersion: typeof CONTENT_PROJECT_HISTORY_SCHEMA_VERSION;
	projectId: string;
	present: ContentProjectFile;
	history: ContentProjectHistoryState;
}

export interface ContentProjectHistoryRepository {
	read(projectId: string): Promise<StoredContentProjectHistory | null>;
	write(projectId: string, present: ContentProjectFile, history: ContentProjectHistoryState): Promise<void>;
}

function historyStorageKey(projectId: string): string {
	return `projects/${encodeURIComponent(projectId)}/history-v1.json`;
}

export class PluginContentProjectHistoryRepository implements ContentProjectHistoryRepository {
	constructor(private readonly storage: PluginStorageApi) {}

	async read(projectId: string): Promise<StoredContentProjectHistory | null> {
		const value = await this.storage.readJson<unknown>(historyStorageKey(projectId));
		return parseStoredContentProjectHistory(value, projectId);
	}

	async write(
		projectId: string,
		present: ContentProjectFile,
		history: ContentProjectHistoryState,
	): Promise<void> {
		await this.storage.writeJson(historyStorageKey(projectId), {
			schemaVersion: CONTENT_PROJECT_HISTORY_SCHEMA_VERSION,
			projectId,
			present,
			history: {
				past: history.past.slice(-CONTENT_PROJECT_HISTORY_LIMIT),
				future: history.future.slice(-CONTENT_PROJECT_HISTORY_LIMIT),
			},
		} satisfies StoredContentProjectHistory);
	}
}

export function parseStoredContentProjectHistory(
	value: unknown,
	expectedProjectId: string,
): StoredContentProjectHistory | null {
	if (!isRecord(value)) return null;
	if (value.schemaVersion !== CONTENT_PROJECT_HISTORY_SCHEMA_VERSION || value.projectId !== expectedProjectId) return null;
	if (!isContentProjectFile(value.present) || value.present.projectId !== expectedProjectId) return null;
	if (!isRecord(value.history) || !Array.isArray(value.history.past) || !Array.isArray(value.history.future)) return null;
	const past = parseFrames(value.history.past, expectedProjectId);
	const future = parseFrames(value.history.future, expectedProjectId);
	if (!past || !future) return null;
	return {
		schemaVersion: CONTENT_PROJECT_HISTORY_SCHEMA_VERSION,
		projectId: expectedProjectId,
		present: value.present,
		history: {
			past: past.slice(-CONTENT_PROJECT_HISTORY_LIMIT),
			future: future.slice(-CONTENT_PROJECT_HISTORY_LIMIT),
		},
	};
}

function parseFrames(values: readonly unknown[], projectId: string): ContentHistoryFrame[] | null {
	const frames: ContentHistoryFrame[] = [];
	for (const value of values) {
		if (!isRecord(value) || typeof value.id !== "string" || typeof value.createdAt !== "string") return null;
		if (value.origin !== "ui" && value.origin !== "agent") return null;
		if (value.groupId !== undefined && typeof value.groupId !== "string") return null;
		if (!isHistoryAction(value.action)) return null;
		if (!isContentProjectFile(value.snapshot) || value.snapshot.projectId !== projectId) return null;
		frames.push({
			id: value.id,
			snapshot: value.snapshot,
			action: value.action,
			origin: value.origin,
			createdAt: value.createdAt,
			...(value.groupId ? { groupId: value.groupId } : {}),
		});
	}
	return frames;
}

function isHistoryAction(value: unknown): value is ContentHistoryAction {
	return (
		isRecord(value) &&
		typeof value.kind === "string" &&
		HISTORY_ACTION_KINDS.has(value.kind as ContentHistoryAction["kind"]) &&
		typeof value.count === "number" &&
		Number.isInteger(value.count) &&
		value.count >= 0
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
