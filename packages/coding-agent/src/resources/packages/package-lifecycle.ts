import type { GitSource } from "../../utils/git.js";
import type { ResourceAccessPort } from "../contracts/resource-access.js";
import type {
	ResourcePackageCommandPort,
	ResourcePackageEnvironmentPort,
	ResourcePackageFilePort,
	ResourcePackageRegistryPort,
	ResourceScope,
} from "../contracts/resource-source.js";
import type { ResourcePackageLocations } from "./resource-package-locations.js";
import { type NpmResourceSource, type ParsedResourceSource, parseNpmResourceSpec } from "./source-spec.js";

export class ResourcePackageLifecycle {
	constructor(
		private readonly locations: ResourcePackageLocations,
		private readonly commands: ResourcePackageCommandPort,
		private readonly registry: ResourcePackageRegistryPort,
		private readonly environment: ResourcePackageEnvironmentPort,
		private readonly resourceAccess: ResourceAccessPort,
		private readonly files: ResourcePackageFilePort,
	) {}

	async getInstalledPath(source: ParsedResourceSource, scope: ResourceScope): Promise<string | undefined> {
		const resourcePath = this.sourcePath(source, scope);
		return (await this.exists(resourcePath)) ? resourcePath : undefined;
	}

	async needsNpmInstall(source: NpmResourceSource, installedPath: string): Promise<boolean> {
		if (this.environment.isOffline()) return false;
		const installedVersion = await this.readInstalledNpmVersion(installedPath);
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
		const resourcePath = this.locations.resolvePath(source.path);
		if (!(await this.exists(resourcePath))) throw new Error(`Path does not exist: ${resourcePath}`);
	}

	async remove(source: ParsedResourceSource, scope: ResourceScope): Promise<void> {
		if (source.type === "npm") {
			if (scope === "user") {
				await this.commands.run("npm", ["uninstall", "-g", source.name]);
				return;
			}
			const installRoot = this.locations.npmInstallRoot(scope, false);
			if (await this.exists(installRoot)) {
				await this.commands.run("npm", ["uninstall", source.name, "--prefix", installRoot]);
			}
			return;
		}
		if (source.type === "git") await this.removeGit(source, scope);
	}

	async update(source: ParsedResourceSource, scope: ResourceScope): Promise<void> {
		if (source.type === "npm") await this.installNpm(source, scope, false);
		else if (source.type === "git") await this.updateGit(source, scope);
	}

	async refreshTemporaryGit(source: GitSource): Promise<void> {
		await this.updateGit(source, "temporary");
	}

	private sourcePath(source: ParsedResourceSource, scope: ResourceScope): string {
		if (source.type === "npm") return this.locations.npmInstallPath(source, scope);
		if (source.type === "git") return this.locations.gitInstallPath(source, scope);
		return this.locations.resolvePathFromBase(source.path, this.locations.baseDir(scope));
	}

	private async readInstalledNpmVersion(installedPath: string): Promise<string | undefined> {
		const packageJsonPath = this.resourceAccess.paths.join(installedPath, "package.json");
		if (!(await this.exists(packageJsonPath))) return undefined;
		try {
			const content = await this.files.readText(packageJsonPath);
			return (JSON.parse(content) as { version?: string }).version;
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
		await this.ensureNpmProject(installRoot);
		await this.commands.run("npm", ["install", source.spec, "--prefix", installRoot]);
	}

	private async installGit(source: GitSource, scope: ResourceScope): Promise<void> {
		const targetDir = this.locations.gitInstallPath(source, scope);
		if (await this.exists(targetDir)) return;
		const gitRoot = this.locations.gitInstallRoot(scope);
		if (gitRoot) await this.ensureGitIgnore(gitRoot);
		await this.files.ensureDirectory(this.resourceAccess.paths.dirname(targetDir));
		await this.commands.run("git", ["clone", source.repo, targetDir]);
		if (source.ref) await this.commands.run("git", ["checkout", source.ref], { cwd: targetDir });
		if (await this.exists(this.resourceAccess.paths.join(targetDir, "package.json"))) {
			await this.commands.run("npm", ["install"], { cwd: targetDir });
		}
	}

	private async updateGit(source: GitSource, scope: ResourceScope): Promise<void> {
		const targetDir = this.locations.gitInstallPath(source, scope);
		if (!(await this.exists(targetDir))) {
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
		if (await this.exists(this.resourceAccess.paths.join(targetDir, "package.json"))) {
			await this.commands.run("npm", ["install"], { cwd: targetDir });
		}
	}

	private async removeGit(source: GitSource, scope: ResourceScope): Promise<void> {
		const targetDir = this.locations.gitInstallPath(source, scope);
		if (!(await this.exists(targetDir))) return;
		await this.files.removeTree(targetDir);
		const installRoot = this.locations.gitInstallRoot(scope);
		if (!installRoot) return;
		const resolvedRoot = this.resourceAccess.paths.resolve(installRoot);
		let current = this.resourceAccess.paths.dirname(targetDir);
		while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
			if (!(await this.exists(current))) {
				current = this.resourceAccess.paths.dirname(current);
				continue;
			}
			if ((await this.files.readDirectory(current)).length > 0) break;
			try {
				await this.files.removeTree(current);
			} catch {
				break;
			}
			current = this.resourceAccess.paths.dirname(current);
		}
	}

	private async ensureNpmProject(installRoot: string): Promise<void> {
		await this.files.ensureDirectory(installRoot);
		await this.ensureGitIgnore(installRoot);
		await this.files.ensureTextFile(
			this.resourceAccess.paths.join(installRoot, "package.json"),
			JSON.stringify({ name: "pi-extensions", private: true }, null, 2),
		);
	}

	private ensureGitIgnore(dir: string): Promise<void> {
		return this.files.ensureTextFile(this.resourceAccess.paths.join(dir, ".gitignore"), "*\n!.gitignore\n");
	}

	private async exists(path: string): Promise<boolean> {
		try {
			return (await this.files.stat(path)) !== undefined;
		} catch {
			return false;
		}
	}
}
