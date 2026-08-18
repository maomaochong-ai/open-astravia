import type { DesktopConfig, ProjectEntry } from "../config/desktop-config-store.js";

export interface ProjectServiceDependencies {
	readonly allowProjectRoot: (path: string) => void;
	readonly createDirectory: (path: string) => Promise<void>;
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly writeConfig: (config: DesktopConfig) => Promise<void>;
	/**
	 * 项目列表落盘后通知渲染进程重读。写入与广播必须成对，否则侧边栏会停在旧快照上
	 * （插件/Action 改完项目要等重启才可见），所以统一走 {@link ProjectService.commit}。
	 */
	readonly broadcastChanged: () => void;
	/**
	 * 这个路径当前是不是一个**已存在的非目录**（文件、软链等）。用于挡住「把文件注册成
	 * 项目」——不存在的路径仍然放行，`open` 本来就允许登记一个还没建出来的目录。
	 */
	readonly isExistingNonDirectory: (path: string) => Promise<boolean>;
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

	/** 唯一的写路径：落盘 + 广播。任何改动项目列表的地方都必须经由它。 */
	private async commit(config: DesktopConfig): Promise<void> {
		await this.dependencies.writeConfig(config);
		this.dependencies.broadcastChanged();
	}

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
			await this.commit({ ...config, projects, archivedProjects });
		}
		this.dependencies.allowProjectRoot(projectPath);
		return { path: projectPath, name: normalizedName };
	}

	async open(path: string, name?: string): Promise<ProjectEntry> {
		if (!isAbsolutePath(path)) throw new Error("Project path must be absolute.");
		// 项目必须是目录。放进来一个文件不会当场报错，而是等到有人去 readdir 它时才炸
		// （ENOTDIR），且从此每次扫描都炸一次——现场就出现过一个 v1 时代的 `x.vetd`
		// **文件**被登记成项目，之后每轮项目扫描都刷一条主进程 error。
		if (await this.dependencies.isExistingNonDirectory(path)) {
			throw new Error("Project path must be a directory.");
		}
		const config = await this.dependencies.readConfig();
		const projects = config.projects.map((entry) => ({ ...entry }));
		const archivedProjects = config.archivedProjects
			.filter((entry) => !samePath(entry.path, path))
			.map((entry) => ({ ...entry }));
		const entry = { path, name: name?.trim() || pathBasename(path) };
		if (!findProject(projects, path)) projects.push(entry);
		await this.commit({ ...config, projects, archivedProjects });
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
		await this.commit({ ...config, projects, archivedProjects });
		return { ...entry };
	}

	async archive(path: string): Promise<void> {
		const config = await this.dependencies.readConfig();
		const entry = findProject(config.projects, path);
		if (!entry) throw new Error(`Active project not found: ${path}`);
		const projects = config.projects.filter((item) => !samePath(item.path, path)).map((item) => ({ ...item }));
		const archivedProjects = config.archivedProjects.map((item) => ({ ...item }));
		if (!findProject(archivedProjects, path)) archivedProjects.push({ ...entry });
		await this.commit({ ...config, projects, archivedProjects });
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
		await this.commit({ ...config, projects, archivedProjects });
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
		await this.commit({ ...config, projects, archivedProjects });
	}
}
