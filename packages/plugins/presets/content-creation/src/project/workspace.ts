import { applyContentProjectCommands, type ContentProjectCommand } from "./commands";
import {
	captureContentProjectHistorySnapshot,
	contentProjectHistorySnapshotsEqual,
	createContentProjectHistoryState,
	getContentProjectHistoryView,
	recordContentProjectHistory,
	redoContentProjectHistory,
	type ContentHistoryMetadata,
	type ContentProjectHistoryState,
	type ContentProjectHistoryView,
	undoContentProjectHistory,
} from "./history";
import type { ContentProjectHistoryRepository } from "./history-repository";
import { migrateContentProjectDocument } from "./migrate-project";
import { createContentProject, type ContentProjectDocument } from "./types";
import type { ContentProjectRepository } from "./repository";

interface ProjectRecord {
	project: ContentProjectDocument;
	history: ContentProjectHistoryState;
	listeners: Set<() => void>;
}

export interface ContentCreationWorkspaceOptions {
	historyRepository?: ContentProjectHistoryRepository;
	onHistoryPersistenceError?: (error: unknown) => void;
}

export class ContentProjectRevisionError extends Error {
	constructor(
		readonly expected: number,
		readonly actual: number,
	) {
		super(`project revision conflict: expected ${expected}, actual ${actual}`);
	}
}

function projectKey(cwd: string | null): string {
	return cwd ?? "__global__";
}

export class ContentCreationWorkspace {
	private readonly records = new Map<string, ProjectRecord>();
	private readonly loads = new Map<string, Promise<ContentProjectDocument>>();
	private readonly queues = new Map<string, Promise<void>>();

	constructor(
		private readonly repository: ContentProjectRepository,
		private readonly options: ContentCreationWorkspaceOptions = {},
	) {}

	getSnapshot(cwd: string | null): ContentProjectDocument | null {
		return this.records.get(projectKey(cwd))?.project ?? null;
	}

	getHistoryView(cwd: string | null): ContentProjectHistoryView {
		return getContentProjectHistoryView(
			this.records.get(projectKey(cwd))?.history ?? createContentProjectHistoryState(),
		);
	}

	subscribe(cwd: string | null, listener: () => void): () => void {
		const key = projectKey(cwd);
		const record = this.records.get(key);
		if (record) record.listeners.add(listener);
		else {
			this.records.set(key, {
				project: createContentProject(cwd),
				history: createContentProjectHistoryState(),
				listeners: new Set([listener]),
			});
		}
		return () => this.records.get(key)?.listeners.delete(listener);
	}

	async load(cwd: string | null): Promise<ContentProjectDocument> {
		const key = projectKey(cwd);
		const current = this.records.get(key);
		if (current && current.project.revision > 0) return current.project;
		const existingLoad = this.loads.get(key);
		if (existingLoad) return existingLoad;
		const load = this.repository
			.read(cwd)
			.then(async (stored) => {
				const migration = stored
					? migrateContentProjectDocument(stored.document, stored.runtime, cwd)
					: null;
				const project = migration?.project ?? current?.project ?? createContentProject(cwd);
				if (migration?.migrated) await this.repository.write(cwd, project);
				const listeners = current?.listeners ?? new Set<() => void>();
				const history = await this.loadHistory(project);
				this.records.set(key, { project, history, listeners });
				for (const listener of listeners) listener();
				return project;
			})
			.finally(() => this.loads.delete(key));
		this.loads.set(key, load);
		return load;
	}

	async dispatch(
		cwd: string | null,
		commands: readonly ContentProjectCommand[],
		expectedRevision?: number,
		historyMetadata?: ContentHistoryMetadata,
	): Promise<ContentProjectDocument> {
		const key = projectKey(cwd);
		const run = async (): Promise<ContentProjectDocument> => {
			const project = await this.load(cwd);
			if (expectedRevision !== undefined && project.revision !== expectedRevision) {
				throw new ContentProjectRevisionError(expectedRevision, project.revision);
			}
			const before = captureContentProjectHistorySnapshot(project);
			const next = applyContentProjectCommands(project, commands);
			if (next === project) return project;
			const record = this.records.get(key);
			const currentHistory = record?.history ?? createContentProjectHistoryState();
			const after = captureContentProjectHistorySnapshot(next);
			const editableSnapshotChanged = !contentProjectHistorySnapshotsEqual(before, after);
			const history = recordContentProjectHistory(
				currentHistory,
				before,
				after,
				commands,
				historyMetadata,
			);
			await this.repository.write(cwd, next);
			const listeners = record?.listeners ?? new Set<() => void>();
			this.records.set(key, { project: next, history, listeners });
			for (const listener of listeners) listener();
			if (editableSnapshotChanged) await this.persistHistory(next, history);
			return next;
		};
		return this.enqueue(key, run);
	}

	async undo(cwd: string | null): Promise<ContentProjectDocument> {
		return this.restoreHistory(cwd, "undo");
	}

	async redo(cwd: string | null): Promise<ContentProjectDocument> {
		return this.restoreHistory(cwd, "redo");
	}

	private async restoreHistory(cwd: string | null, direction: "undo" | "redo"): Promise<ContentProjectDocument> {
		const key = projectKey(cwd);
		return this.enqueue(key, async () => {
			const project = await this.load(cwd);
			const record = this.records.get(key);
			const history = record?.history ?? createContentProjectHistoryState();
			const restored = direction === "undo"
				? undoContentProjectHistory(project, history)
				: redoContentProjectHistory(project, history);
			if (!restored) return project;
			await this.repository.write(cwd, restored.project);
			const listeners = record?.listeners ?? new Set<() => void>();
			this.records.set(key, { project: restored.project, history: restored.history, listeners });
			for (const listener of listeners) listener();
			await this.persistHistory(restored.project, restored.history);
			return restored.project;
		});
	}

	private async loadHistory(project: ContentProjectDocument): Promise<ContentProjectHistoryState> {
		const repository = this.options.historyRepository;
		if (!repository) return createContentProjectHistoryState();
		try {
			const stored = await repository.read(project.projectId);
			if (
				stored &&
				contentProjectHistorySnapshotsEqual(
					stored.present,
					captureContentProjectHistorySnapshot(project),
				)
			) {
				return stored.history;
			}
		} catch (error) {
			this.options.onHistoryPersistenceError?.(error);
		}
		return createContentProjectHistoryState();
	}

	private async persistHistory(
		project: ContentProjectDocument,
		history: ContentProjectHistoryState,
	): Promise<void> {
		const repository = this.options.historyRepository;
		if (!repository) return;
		try {
			await repository.write(project.projectId, captureContentProjectHistorySnapshot(project), history);
		} catch (error) {
			this.options.onHistoryPersistenceError?.(error);
		}
	}

	private enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(key) ?? Promise.resolve();
		const queued = previous.then(run, run);
		this.queues.set(
			key,
			queued.then(
				() => undefined,
				() => undefined,
			),
		);
		return queued;
	}
}
