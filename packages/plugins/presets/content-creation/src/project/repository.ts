import type { PluginFsApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import { joinContentPath } from "../shared/path";
import type { ContentProjectDocument } from "./types";

export interface ContentProjectRepository {
	read(cwd: string | null): Promise<unknown>;
	write(cwd: string | null, project: ContentProjectDocument): Promise<void>;
}

function projectFile(cwd: string): string {
	return joinContentPath(cwd, "content-creation.json");
}

function legacyProjectFile(cwd: string): string {
	return joinContentPath(cwd, ".vetta", "content-creation", "project.json");
}

export class PluginContentProjectRepository implements ContentProjectRepository {
	constructor(
		private readonly fs: PluginFsApi,
		private readonly storage: PluginStorageApi,
	) {}

	async read(cwd: string | null): Promise<unknown> {
		if (!cwd) return this.storage.readJson<unknown>("projects/global.json");
		const path = projectFile(cwd);
		if (await this.fs.stat(path)) {
			const file = await this.fs.readFile(path);
			return JSON.parse(file.content) as unknown;
		}
		const legacyPath = legacyProjectFile(cwd);
		if (!(await this.fs.stat(legacyPath))) return null;
		const file = await this.fs.readFile(legacyPath);
		await this.fs.writeFile(path, file.content, "utf8");
		return JSON.parse(file.content) as unknown;
	}

	async write(cwd: string | null, project: ContentProjectDocument): Promise<void> {
		if (!cwd) {
			await this.storage.writeJson("projects/global.json", project);
			return;
		}
		await this.fs.writeFile(projectFile(cwd), `${JSON.stringify(project, null, 2)}\n`, "utf8");
	}
}
