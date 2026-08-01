import type { PluginFsApi, PluginStorageApi } from "@vetta-org/plugin-sdk";
import type { ContentProjectDocument } from "../domain/model";

export interface ContentProjectRepository {
	read(cwd: string | null): Promise<unknown>;
	write(cwd: string | null, project: ContentProjectDocument): Promise<void>;
}

function joinPath(root: string, ...parts: string[]): string {
	const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
	let result = root.replace(/[/\\]+$/, "");
	for (const part of parts) {
		const clean = part.replace(/^[/\\]+/, "").replace(/[/\\]+/g, separator);
		result = `${result}${separator}${clean}`;
	}
	return result;
}

function projectDirectory(cwd: string): string {
	return joinPath(cwd, ".vetta", "content-creation");
}

function projectFile(cwd: string): string {
	return joinPath(projectDirectory(cwd), "project.json");
}

export class PluginContentProjectRepository implements ContentProjectRepository {
	constructor(
		private readonly fs: PluginFsApi,
		private readonly storage: PluginStorageApi,
	) {}

	async read(cwd: string | null): Promise<unknown> {
		if (!cwd) return this.storage.readJson<unknown>("projects/global.json");
		const path = projectFile(cwd);
		if (!(await this.fs.stat(path))) return null;
		const file = await this.fs.readFile(path);
		return JSON.parse(file.content) as unknown;
	}

	async write(cwd: string | null, project: ContentProjectDocument): Promise<void> {
		if (!cwd) {
			await this.storage.writeJson("projects/global.json", project);
			return;
		}
		await this.fs.createDirectory(projectDirectory(cwd));
		await this.fs.writeFile(projectFile(cwd), `${JSON.stringify(project, null, 2)}\n`, "utf8");
	}
}

