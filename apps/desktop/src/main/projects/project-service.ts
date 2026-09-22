import { parseProjectLocation } from "@vetta/ssh-transport";
import type { DesktopConfig, ProjectEntry } from "../config/desktop-config-store.js";
import { sameProjectPath } from "./project-path.js";

export interface ProjectServiceDependencies {
	readonly allowProjectRoot: (path: string) => void;
	readonly createDirectory: (path: string) => Promise<void>;
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly writeConfig: (config: DesktopConfig) => Promise<void>;
	/**
	 * 这个 hostId 是否对应一台已登记的 SSH 主机。
	 *
	 * 注册时就要挡住未知主机：放进去的条目在侧边栏看起来和正常项目一样，点开才发现
	 * 永远连不上，而那时已经看不出它指向的是一台早就被删掉的主机。
	 */
	readonly isKnownSshHost: (hostId: string) => Promise<boolean>;
	/** 项目从列表移除（含归档区）并落盘后调用；自动化据此暂停以它为目标的任务。 */
	readonly onRemoved?: (path: string) => void;
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

/** 这个项目标识指向远程主机吗。远程项目的 path 是 `ssh://<hostId>/<路径>`（ADR-0124）。 */
function resolveLocation(path: string): ReturnType<typeof parseProjectLocation> {
	try {
		return parseProjectLocation(path);
	} catch {
		// 畸形的 ssh:// 串不能当成本地相对路径放行，否则会落到本机某个同名目录上。
		throw new Error(`Invalid project path: ${path}`);
	}
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

function findProject(entries: readonly ProjectEntry[], path: string): ProjectEntry | undefined {
	return entries.find((entry) => sameProjectPath(entry.path, path));
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
		// 「新建项目」是在本地工作区里造一个目录；远端主机上没有这个工作区的概念，
		// 要登记远端已有目录走 open。
		if (resolveLocation(projectPath).kind === "ssh") {
			throw new Error("Remote projects must be registered with open(), not create().");
		}
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
		const location = resolveLocation(path);
		if (location.kind === "ssh") {
			// 主机不存在时立刻拒绝，而不是留下一条永远打不开的条目。
			if (!(await this.dependencies.isKnownSshHost(location.hostId))) {
				throw new Error(`Unknown SSH host: ${location.hostId}`);
			}
		} else if (!isAbsolutePath(path)) {
			throw new Error("Project path must be absolute.");
		}
		// 项目必须是目录。放进来一个文件不会当场报错，而是等到有人去 readdir 它时才炸
		// （ENOTDIR），且从此每次扫描都炸一次——现场就出现过一个 v1 时代的 `x.vetd`
		// **文件**被登记成项目，之后每轮项目扫描都刷一条主进程 error。
		if (await this.dependencies.isExistingNonDirectory(path)) {
			throw new Error("Project path must be a directory.");
		}
		const config = await this.dependencies.readConfig();
		const projects = config.projects.map((entry) => ({ ...entry }));
		const archivedProjects = config.archivedProjects
			.filter((entry) => !sameProjectPath(entry.path, path))
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
		const projects = config.projects.filter((item) => !sameProjectPath(item.path, path)).map((item) => ({ ...item }));
		const archivedProjects = config.archivedProjects.map((item) => ({ ...item }));
		if (!findProject(archivedProjects, path)) archivedProjects.push({ ...entry });
		await this.commit({ ...config, projects, archivedProjects });
	}

	async unarchive(path: string): Promise<void> {
		const config = await this.dependencies.readConfig();
		const entry = findProject(config.archivedProjects, path);
		if (!entry) throw new Error(`Archived project not found: ${path}`);
		const archivedProjects = config.archivedProjects
			.filter((item) => !sameProjectPath(item.path, path))
			.map((item) => ({ ...item }));
		const projects = config.projects.map((item) => ({ ...item }));
		if (!findProject(projects, path)) projects.push({ ...entry });
		await this.commit({ ...config, projects, archivedProjects });
		this.dependencies.allowProjectRoot(path);
	}

	async remove(path: string): Promise<void> {
		const config = await this.dependencies.readConfig();
		const projects = config.projects.filter((item) => !sameProjectPath(item.path, path)).map((item) => ({ ...item }));
		const archivedProjects = config.archivedProjects
			.filter((item) => !sameProjectPath(item.path, path))
			.map((item) => ({ ...item }));
		if (projects.length === config.projects.length && archivedProjects.length === config.archivedProjects.length) {
			throw new Error(`Project not found: ${path}`);
		}
		await this.commit({ ...config, projects, archivedProjects });
		this.dependencies.onRemoved?.(path);
	}
}
