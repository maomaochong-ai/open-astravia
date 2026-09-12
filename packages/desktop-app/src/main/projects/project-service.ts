import type { DesktopConfig, ProjectEntry } from "../config/desktop-config-store.js";

export interface ProjectServiceDependencies {
	readonly allowProjectRoot: (path: string) => void;
	readonly createDirectory: (path: string) => Promise<void>;
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly writeConfig: (config: DesktopConfig) => Promise<void>;
	readonly onProjectsChanged: () => void;
}

export interface ProjectListSnapshot {
	readonly workspacePath: string;
	readonly projects: readonly ProjectEntry[];
	readonly archivedProjects: readonly ProjectEntry[];
}

function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function joinPath(base: string, name: string): string {
	const separator = base.includes("\\") ? "\\" : "/";
	return `${base.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function pathBasename(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const parts = normalized.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

function samePath(first: string, second: string): boolean {
	const normalize = (value: string): string => value.replace(/[\\/]+$/, "").toLowerCase();
	return normalize(first) === normalize(second);
}

function findProject(entries: readonly ProjectEntry[], path: string): ProjectEntry | undefined {
	return entries.find((entry) => samePath(entry.path, path));
}

function assertProjectName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length === 0 || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
		throw new Error("Invalid project name.");
	}
	return trimmed;
}

export class ProjectService {
	constructor(private readonly dependencies: ProjectServiceDependencies) {}

	async list(): Promise<ProjectListSnapshot> {
		const config = await this.dependencies.readConfig();
		return {
			workspacePath: config.workspacePath,
			projects: config.projects.map((entry) => ({ ...entry })),
			archivedProjects: config.archivedProjects.map((entry) => ({ ...entry })),
		};
	}

	async create(name: string, path?: string): Promise<ProjectEntry> {
		const normalizedName = assertProjectName(name);
		const config = await this.dependencies.readConfig();
		const projectPath = path?.trim() ? path.trim() : joinPath(config.workspacePath, normalizedName);
		if (!isAbsolutePath(projectPath)) throw new Error("Project path must be absolute.");

		await this.dependencies.createDirectory(projectPath);
		const projects = config.projects.map((entry) => ({ ...entry }));
		const archivedProjects = config.archivedProjects.map((entry) => ({ ...entry }));
		if (!findProject(projects, projectPath) && !findProject(archivedProjects, projectPath)) {
			projects.push({ path: projectPath, name: normalizedName });
			await this.persist({ ...config, projects, archivedProjects });
		}
		this.dependencies.allowProjectRoot(projectPath);
		return { path: projectPath, name: normalizedName };
	}

	async open(path: string, name?: string): Promise<ProjectEntry> {
		if (!isAbsolutePath(path)) throw new Error("Project path must be absolute.");
		const config = await this.dependencies.readConfig();
		const projects = config.projects.map((entry) => ({ ...entry }));
		const archivedProjects = config.archivedProjects
			.filter((entry) => !samePath(entry.path, path))
			.map((entry) => ({ ...entry }));
		const entry = { path, name: name?.trim() || pathBasename(path) };
		if (!findProject(projects, path)) projects.push(entry);
		await this.persist({ ...config, projects, archivedProjects });
		this.dependencies.allowProjectRoot(path);
		return entry;
	}

	async rename(path: string, name: string): Promise<ProjectEntry> {
		const config = await this.dependencies.readConfig();
		const projects = config.projects.map((entry) => ({ ...entry }));
		const archivedProjects = config.archivedProjects.map((entry) => ({ ...entry }));
		const entry = findProject(projects, path) ?? findProject(archivedProjects, path);
		if (!entry) throw new Error(`Project not found: ${path}`);
		entry.name = name;
		await this.persist({ ...config, projects, archivedProjects });
		return { ...entry };
	}

	async archive(path: string): Promise<void> {
		const config = await this.dependencies.readConfig();
		const entry = findProject(config.projects, path);
		if (!entry) throw new Error(`Active project not found: ${path}`);
		const projects = config.projects.filter((item) => !samePath(item.path, path)).map((item) => ({ ...item }));
		const archivedProjects = config.archivedProjects.map((item) => ({ ...item }));
		if (!findProject(archivedProjects, path)) archivedProjects.push({ ...entry });
		await this.persist({ ...config, projects, archivedProjects });
	}

	async unarchive(path: string): Promise<void> {
		const config = await this.dependencies.readConfig();
		const entry = findProject(config.archivedProjects, path);
		if (!entry) throw new Error(`Archived project not found: ${path}`);
		const archivedProjects = config.archivedProjects
			.filter((item) => !samePath(item.path, path))
			.map((item) => ({ ...item }));
		const projects = config.projects.map((item) => ({ ...item }));
		if (!findProject(projects, path)) projects.push({ ...entry });
		await this.persist({ ...config, projects, archivedProjects });
		this.dependencies.allowProjectRoot(path);
	}

	async remove(path: string): Promise<void> {
		const config = await this.dependencies.readConfig();
		const projects = config.projects.filter((item) => !samePath(item.path, path)).map((item) => ({ ...item }));
		const archivedProjects = config.archivedProjects
			.filter((item) => !samePath(item.path, path))
			.map((item) => ({ ...item }));
		if (projects.length === config.projects.length && archivedProjects.length === config.archivedProjects.length) {
			throw new Error(`Project not found: ${path}`);
		}
		await this.persist({ ...config, projects, archivedProjects });
	}

	/** 写配置后广播项目列表变更，让渲染进程（侧栏等）与磁盘状态保持一致。 */
	private async persist(config: DesktopConfig): Promise<void> {
		await this.dependencies.writeConfig(config);
		this.dependencies.onProjectsChanged?.();
	}
}
