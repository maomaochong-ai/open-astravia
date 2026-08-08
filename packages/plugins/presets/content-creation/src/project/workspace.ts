import { applyContentProjectCommands, type ContentProjectCommand } from "./commands";
import { migrateContentProjectDocument } from "./migrate-project";
import { createContentProject, type ContentProjectDocument } from "./types";
import type { ContentProjectRepository } from "./repository";

interface ProjectRecord {
	project: ContentProjectDocument;
	listeners: Set<() => void>;
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

	constructor(private readonly repository: ContentProjectRepository) {}

	getSnapshot(cwd: string | null): ContentProjectDocument | null {
		return this.records.get(projectKey(cwd))?.project ?? null;
	}

	subscribe(cwd: string | null, listener: () => void): () => void {
		const key = projectKey(cwd);
		const record = this.records.get(key);
		if (record) record.listeners.add(listener);
		else this.records.set(key, { project: createContentProject(cwd), listeners: new Set([listener]) });
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
				this.records.set(key, { project, listeners });
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
	): Promise<ContentProjectDocument> {
		const key = projectKey(cwd);
		const previous = this.queues.get(key) ?? Promise.resolve();
		const run = async (): Promise<ContentProjectDocument> => {
			const project = await this.load(cwd);
			if (expectedRevision !== undefined && project.revision !== expectedRevision) {
				throw new ContentProjectRevisionError(expectedRevision, project.revision);
			}
			const next = applyContentProjectCommands(project, commands);
			if (next === project) return project;
			await this.repository.write(cwd, next);
			const record = this.records.get(key);
			const listeners = record?.listeners ?? new Set<() => void>();
			this.records.set(key, { project: next, listeners });
			for (const listener of listeners) listener();
			return next;
		};
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
