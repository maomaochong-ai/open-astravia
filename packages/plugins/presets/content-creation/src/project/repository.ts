import type { PluginFsApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import { joinContentPath } from "../shared/path";
import { serializeContentProject, serializeContentProjectRuntime } from "./persistence";
import type { ContentProjectDocument } from "./types";

export interface StoredContentProject {
	document: unknown;
	runtime: unknown;
}

export interface ContentProjectRepository {
	read(cwd: string | null): Promise<StoredContentProject | null>;
	write(cwd: string | null, project: ContentProjectDocument): Promise<void>;
}

function projectFile(cwd: string): string {
	return joinContentPath(cwd, "content-creation.json");
}

function legacyProjectFile(cwd: string): string {
	return joinContentPath(cwd, ".vetta", "content-creation", "project.json");
}

function runtimeStorageKey(projectId: string): string {
	return `projects/${encodeURIComponent(projectId)}/runtime.json`;
}

export class PluginContentProjectRepository implements ContentProjectRepository {
	constructor(
		private readonly fs: PluginFsApi,
		private readonly storage: PluginStorageApi,
	) {}

	async read(cwd: string | null): Promise<StoredContentProject | null> {
		if (!cwd) {
			const document = await this.storage.readJson<unknown>("projects/global.json");
			return await this.withRuntime(document);
		}
		const path = projectFile(cwd);
		if (await this.fs.stat(path)) {
			const file = await this.fs.readFile(path);
			return await this.withRuntime(JSON.parse(file.content) as unknown);
		}
		const legacyPath = legacyProjectFile(cwd);
		if (!(await this.fs.stat(legacyPath))) return null;
		const file = await this.fs.readFile(legacyPath);
		await this.fs.writeFile(path, file.content, "utf8");
		return await this.withRuntime(JSON.parse(file.content) as unknown);
	}

	async write(cwd: string | null, project: ContentProjectDocument): Promise<void> {
		await this.storage.writeJson(runtimeStorageKey(project.projectId), serializeContentProjectRuntime(project));
		const document = serializeContentProject(project);
		if (!cwd) {
			await this.storage.writeJson("projects/global.json", document);
			return;
		}
		await this.fs.writeFile(projectFile(cwd), `${JSON.stringify(document, null, 2)}\n`, "utf8");
	}

	private async withRuntime(document: unknown): Promise<StoredContentProject | null> {
		if (!document || typeof document !== "object" || !("projectId" in document)) return null;
		const projectId = (document as { projectId?: unknown }).projectId;
		if (typeof projectId !== "string" || projectId.length === 0) return { document, runtime: null };
		return {
			document,
			runtime: await this.storage.readJson<unknown>(runtimeStorageKey(projectId)),
		};
	}
}
