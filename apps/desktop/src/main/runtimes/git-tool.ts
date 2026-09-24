import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { getAppLogger } from "../logger.js";
import { downloadToFile } from "./download.js";
import { type CommandResult, detectSystemGit, gitInstallGuide } from "./git-detection.js";
import {
	type GitPlatformEntry,
	gitBinDir,
	gitExecutablePath,
	gitInstallDir,
	gitPlatformEntry,
	RUNTIME_MANIFEST,
	runtimesDir,
} from "./paths.js";
import { installRuntimeArchive } from "./runtime-archive-installer.js";
import type { GitToolStatus } from "./types.js";

const log = getAppLogger("runtimes");

/** GitToolManager 触达的全部外部边界。 */
export interface GitToolDeps {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	exists(path: string): boolean;
	run(command: string, args: readonly string[]): CommandResult;
	readOsRelease(): string | undefined;
	launchXcodeInstaller(): void;
	download(url: string, dest: string): Promise<void>;
	sha256File(path: string): Promise<string>;
	extractArchive(archivePath: string, targetDirectory: string): Promise<void>;
	managed: {
		entry: GitPlatformEntry | undefined;
		version: string;
		tag: string;
		sources: readonly string[];
		binDir: string;
		executablePath: string;
		installDir: string;
		cacheDir: string;
	};
}

function pathKeyOf(env: NodeJS.ProcessEnv): string {
	return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

export function createGitToolDeps(): GitToolDeps {
	return {
		platform: process.platform,
		env: process.env,
		exists: existsSync,
		run: (command, args) => {
			const res = spawnSync(command, args, { encoding: "utf-8", timeout: 5000, windowsHide: true });
			return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
		},
		readOsRelease: () => {
			try {
				return readFileSync("/etc/os-release", "utf-8");
			} catch {
				return undefined;
			}
		},
		launchXcodeInstaller: () => {
			const child = spawn("xcode-select", ["--install"], { detached: true, stdio: "ignore" });
			child.on("error", (err) => log.warn("xcode-select --install failed", err));
			child.unref();
		},
		download: (url, dest) => downloadToFile(url, dest),
		sha256File: async (path) =>
			createHash("sha256")
				.update(await readFile(path))
				.digest("hex"),
		extractArchive: (archivePath, targetDirectory) =>
			// MinGit 归档内容直接在根上，没有顶层目录。
			installRuntimeArchive({ archivePath, archiveType: "zip", innerDirectory: "", targetDirectory }),
		managed: {
			entry: gitPlatformEntry(),
			version: RUNTIME_MANIFEST.git.version,
			tag: RUNTIME_MANIFEST.git.tag,
			sources: RUNTIME_MANIFEST.git.sources,
			binDir: gitBinDir(),
			executablePath: gitExecutablePath(),
			installDir: gitInstallDir(),
			cacheDir: join(runtimesDir(), ".cache"),
		},
	};
}

/**
 * Git 检测与安装引导（ADR-0134）。系统 git 优先；Windows 上缺 git 时可把 MinGit
 * 装进 ~/.vetta/runtimes，并追加到 PATH 末尾，只在 Vetta 进程树内生效。
 */
export class GitToolManager {
	private status: GitToolStatus | null = null;
	private installing: Promise<GitToolStatus> | null = null;

	constructor(private readonly deps: GitToolDeps = createGitToolDeps()) {}

	private managedReady(): boolean {
		return Boolean(this.deps.managed.entry) && this.deps.exists(this.deps.managed.executablePath);
	}

	detect(): GitToolStatus {
		const { deps } = this;
		const install = gitInstallGuide({
			platform: deps.platform,
			managedVersion: deps.managed.entry ? deps.managed.version : undefined,
			readOsRelease: deps.readOsRelease,
		});
		const system = detectSystemGit(
			{
				platform: deps.platform,
				pathValue: deps.env[pathKeyOf(deps.env)] ?? "",
				exists: deps.exists,
				run: deps.run,
			},
			[deps.managed.binDir],
		);
		if (system) {
			this.status = {
				available: true,
				source: "system",
				version: system.version,
				executablePath: system.path,
				install,
			};
		} else if (this.managedReady()) {
			this.status = {
				available: true,
				source: "managed",
				version: deps.managed.version,
				executablePath: deps.managed.executablePath,
				install,
			};
		} else {
			this.status = { available: false, install };
		}
		return this.status;
	}

	getStatus(): GitToolStatus {
		return this.status ?? this.detect();
	}

	/**
	 * macOS 上 PATH 命中 /usr/bin/git 却没装命令行工具时，执行它会弹系统安装框。
	 * 宿主替插件挡掉这次调用；不可用时重新探测，用户刚装好就立即放行。
	 */
	shouldBlockGitCommand(): boolean {
		if (this.deps.platform !== "darwin") return false;
		if (this.getStatus().available) return false;
		return !this.detect().available;
	}

	/** 托管 MinGit 追加在 PATH 末尾：之后装上的系统 git 会自然盖过它。幂等。 */
	applyEnv(): void {
		if (!this.managedReady()) return;
		const { env, managed } = this.deps;
		const key = pathKeyOf(env);
		const entries = (env[key] ?? "").split(delimiter).filter(Boolean);
		if (entries.includes(managed.binDir)) return;
		env[key] = [...entries, managed.binDir].join(delimiter);
	}

	/** macOS 调起系统安装窗口后立即返回；Windows 下载并装好 MinGit 后返回。 */
	install(): Promise<GitToolStatus> {
		if (this.deps.platform === "darwin") {
			this.deps.launchXcodeInstaller();
			return Promise.resolve(this.detect());
		}
		if (this.deps.platform === "win32" && this.deps.managed.entry) {
			this.installing ??= this.installManaged().finally(() => {
				this.installing = null;
			});
			return this.installing;
		}
		return Promise.reject(new Error(`git install is not supported on ${this.deps.platform}`));
	}

	private async installManaged(): Promise<GitToolStatus> {
		const { managed } = this.deps;
		const entry = managed.entry;
		if (!entry) throw new Error("managed git is not available on this platform");
		mkdirSync(managed.cacheDir, { recursive: true });
		const archivePath = join(managed.cacheDir, entry.filename);
		let lastError: unknown;
		for (const template of managed.sources) {
			const url = template.replace("{tag}", managed.tag).replace("{filename}", entry.filename);
			try {
				log.info(`downloading git from ${url}`);
				await this.deps.download(url, archivePath);
				const actual = await this.deps.sha256File(archivePath);
				if (actual !== entry.sha256) throw new Error(`sha256 mismatch: expected ${entry.sha256}, got ${actual}`);
				await this.deps.extractArchive(archivePath, managed.installDir);
				if (!this.deps.exists(managed.executablePath)) throw new Error("git.exe missing after extraction");
				this.applyEnv();
				return this.detect();
			} catch (err) {
				lastError = err;
				log.warn(`git download from ${url} failed`, err);
			} finally {
				rmSync(archivePath, { force: true });
			}
		}
		throw lastError instanceof Error ? lastError : new Error("git download failed");
	}
}
