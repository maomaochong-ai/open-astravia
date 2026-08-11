import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GitSource } from "../../utils/git.js";
import type {
	ResourcePackageCommandPort,
	ResourcePackageRegistryPort,
	ResourceScope,
} from "../contracts/resource-source.js";
import { isResourcePackageOffline } from "./package-effects.js";
import {
	type NpmResourceSource,
	type ParsedResourceSource,
	parseNpmResourceSpec,
	type ResourcePackageLocations,
} from "./source-spec.js";

export class ResourcePackageLifecycle {
	constructor(
		private readonly locations: ResourcePackageLocations,
		private readonly commands: ResourcePackageCommandPort,
		private readonly registry: ResourcePackageRegistryPort,
	) {}

	getInstalledPath(source: ParsedResourceSource, scope: ResourceScope): string | undefined {
		const path =
			source.type === "npm"
				? this.locations.npmInstallPath(source, scope)
				: source.type === "git"
					? this.locations.gitInstallPath(source, scope)
					: this.locations.resolvePathFromBase(source.path, this.locations.baseDir(scope));
		return existsSync(path) ? path : undefined;
	}

	async needsNpmInstall(source: NpmResourceSource, installedPath: string): Promise<boolean> {
		if (isResourcePackageOffline()) return false;
		const installedVersion = this.readInstalledNpmVersion(installedPath);
		if (!installedVersion) return true;
		const { version: pinnedVersion } = parseNpmResourceSpec(source.spec);
		if (pinnedVersion) return installedVersion !== pinnedVersion;
		try {
			return (await this.registry.getLatestVersion(source.name)) !== installedVersion;
		} catch {
			return false;
		}
	}

	async install(source: ParsedResourceSource, scope: ResourceScope, temporary = false): Promise<void> {
		if (source.type === "npm") {
			await this.installNpm(source, scope, temporary);
			return;
		}
		if (source.type === "git") {
			await this.installGit(source, scope);
			return;
		}
		const path = this.locations.resolvePath(source.path);
		if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`);
	}

	async remove(source: ParsedResourceSource, scope: ResourceScope): Promise<void> {
		if (source.type === "npm") {
			if (scope === "user") {
				await this.commands.run("npm", ["uninstall", "-g", source.name]);
				return;
			}
			const installRoot = this.locations.npmInstallRoot(scope, false);
			if (existsSync(installRoot)) {
				await this.commands.run("npm", ["uninstall", source.name, "--prefix", installRoot]);
			}
			return;
		}
		if (source.type === "git") this.removeGit(source, scope);
	}

	async update(source: ParsedResourceSource, scope: ResourceScope): Promise<void> {
		if (source.type === "npm") await this.installNpm(source, scope, false);
		else if (source.type === "git") await this.updateGit(source, scope);
	}

	async refreshTemporaryGit(source: GitSource): Promise<void> {
		await this.updateGit(source, "temporary");
	}

	private readInstalledNpmVersion(installedPath: string): string | undefined {
		const packageJsonPath = join(installedPath, "package.json");
		if (!existsSync(packageJsonPath)) return undefined;
		try {
			return (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: string }).version;
		} catch {
			return undefined;
		}
	}

	private async installNpm(source: NpmResourceSource, scope: ResourceScope, temporary: boolean): Promise<void> {
		if (scope === "user" && !temporary) {
			await this.commands.run("npm", ["install", "-g", source.spec]);
			return;
		}
		const installRoot = this.locations.npmInstallRoot(scope, temporary);
		this.ensureNpmProject(installRoot);
		await this.commands.run("npm", ["install", source.spec, "--prefix", installRoot]);
	}

	private async installGit(source: GitSource, scope: ResourceScope): Promise<void> {
		const targetDir = this.locations.gitInstallPath(source, scope);
		if (existsSync(targetDir)) return;
		const gitRoot = this.locations.gitInstallRoot(scope);
		if (gitRoot) this.ensureGitIgnore(gitRoot);
		mkdirSync(dirname(targetDir), { recursive: true });
		await this.commands.run("git", ["clone", source.repo, targetDir]);
		if (source.ref) await this.commands.run("git", ["checkout", source.ref], { cwd: targetDir });
		if (existsSync(join(targetDir, "package.json"))) await this.commands.run("npm", ["install"], { cwd: targetDir });
	}

	private async updateGit(source: GitSource, scope: ResourceScope): Promise<void> {
		const targetDir = this.locations.gitInstallPath(source, scope);
		if (!existsSync(targetDir)) {
			await this.installGit(source, scope);
			return;
		}
		await this.commands.run("git", ["fetch", "--prune", "origin"], { cwd: targetDir });
		try {
			await this.commands.run("git", ["reset", "--hard", "@{upstream}"], { cwd: targetDir });
		} catch {
			await this.commands.run("git", ["remote", "set-head", "origin", "-a"], { cwd: targetDir }).catch(() => {});
			await this.commands.run("git", ["reset", "--hard", "origin/HEAD"], { cwd: targetDir });
		}
		await this.commands.run("git", ["clean", "-fdx"], { cwd: targetDir });
		if (existsSync(join(targetDir, "package.json"))) await this.commands.run("npm", ["install"], { cwd: targetDir });
	}

	private removeGit(source: GitSource, scope: ResourceScope): void {
		const targetDir = this.locations.gitInstallPath(source, scope);
		if (!existsSync(targetDir)) return;
		rmSync(targetDir, { recursive: true, force: true });
		const installRoot = this.locations.gitInstallRoot(scope);
		if (!installRoot) return;
		const resolvedRoot = resolve(installRoot);
		let current = dirname(targetDir);
		while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
			if (!existsSync(current)) {
				current = dirname(current);
				continue;
			}
			if (readdirSync(current).length > 0) break;
			try {
				rmSync(current, { recursive: true, force: true });
			} catch {
				break;
			}
			current = dirname(current);
		}
	}

	private ensureNpmProject(installRoot: string): void {
		if (!existsSync(installRoot)) mkdirSync(installRoot, { recursive: true });
		this.ensureGitIgnore(installRoot);
		const packageJsonPath = join(installRoot, "package.json");
		if (!existsSync(packageJsonPath)) {
			writeFileSync(packageJsonPath, JSON.stringify({ name: "pi-extensions", private: true }, null, 2), "utf-8");
		}
	}

	private ensureGitIgnore(dir: string): void {
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const ignorePath = join(dir, ".gitignore");
		if (!existsSync(ignorePath)) writeFileSync(ignorePath, "*\n!.gitignore\n", "utf-8");
	}
}
