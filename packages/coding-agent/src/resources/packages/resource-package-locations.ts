import { CONFIG_DIR_NAME } from "../../config.js";
import type { GitSource } from "../../utils/git.js";
import type { ResourcePathPort } from "../contracts/resource-access.js";
import type {
	ResourcePackageDigestPort,
	ResourcePackageLocationFacts,
	ResourceScope,
} from "../contracts/resource-source.js";
import { type NpmResourceSource, parseResourceSource } from "./source-spec.js";

export interface ResourcePackageLocationsOptions {
	readonly cwd: string;
	readonly agentDir: string;
	readonly paths: ResourcePathPort;
	readonly locationFacts: ResourcePackageLocationFacts;
	readonly digest: ResourcePackageDigestPort;
}

export class ResourcePackageLocations {
	readonly cwd: string;
	readonly agentDir: string;
	private readonly paths: ResourcePathPort;
	private readonly locationFacts: ResourcePackageLocationFacts;
	private readonly digest: ResourcePackageDigestPort;

	constructor(options: ResourcePackageLocationsOptions) {
		this.cwd = options.cwd;
		this.agentDir = options.agentDir;
		this.paths = options.paths;
		this.locationFacts = options.locationFacts;
		this.digest = options.digest;
	}

	resolvePath(input: string): string {
		return this.resolvePathFromBase(input, this.cwd);
	}

	resolvePathFromBase(input: string, baseDir: string): string {
		const trimmed = input.trim();
		if (trimmed === "~") return this.locationFacts.homeDirectory;
		if (trimmed.startsWith("~/")) return this.paths.join(this.locationFacts.homeDirectory, trimmed.slice(2));
		if (trimmed.startsWith("~")) return this.paths.join(this.locationFacts.homeDirectory, trimmed.slice(1));
		return this.paths.resolve(baseDir, trimmed);
	}

	baseDir(scope: ResourceScope): string {
		if (scope === "project") return this.paths.join(this.cwd, CONFIG_DIR_NAME);
		if (scope === "user") return this.agentDir;
		return this.cwd;
	}

	npmInstallRoot(scope: ResourceScope, temporary: boolean): string {
		if (temporary) return this.temporaryDir("npm");
		if (scope === "project") return this.paths.join(this.cwd, CONFIG_DIR_NAME, "npm");
		return this.paths.join(this.getGlobalNpmRoot(), "..");
	}

	npmInstallPath(source: NpmResourceSource, scope: ResourceScope): string {
		if (scope === "temporary") return this.paths.join(this.temporaryDir("npm"), "node_modules", source.name);
		if (scope === "project") return this.paths.join(this.cwd, CONFIG_DIR_NAME, "npm", "node_modules", source.name);
		return this.paths.join(this.getGlobalNpmRoot(), source.name);
	}

	gitInstallPath(source: GitSource, scope: ResourceScope): string {
		if (scope === "temporary") return this.temporaryDir(`git-${source.host}`, source.path);
		if (scope === "project") return this.paths.join(this.cwd, CONFIG_DIR_NAME, "git", source.host, source.path);
		return this.paths.join(this.agentDir, "git", source.host, source.path);
	}

	gitInstallRoot(scope: ResourceScope): string | undefined {
		if (scope === "temporary") return undefined;
		if (scope === "project") return this.paths.join(this.cwd, CONFIG_DIR_NAME, "git");
		return this.paths.join(this.agentDir, "git");
	}

	temporaryDir(prefix: string, suffix?: string): string {
		const hash = this.digest.sha256Hex(`${prefix}-${suffix ?? ""}`).slice(0, 8);
		return this.paths.join(this.locationFacts.temporaryDirectory, "pi-extensions", prefix, hash, suffix ?? "");
	}

	identity(source: string, scope?: ResourceScope): string {
		const parsed = parseResourceSource(source);
		if (parsed.type === "npm") return `npm:${parsed.name}`;
		if (parsed.type === "git") return `git:${parsed.host}/${parsed.path}`;
		const resolved = scope
			? this.resolvePathFromBase(parsed.path, this.baseDir(scope))
			: this.resolvePath(parsed.path);
		return `local:${resolved}`;
	}

	matchSettingsSource(existing: string, input: string, scope: ResourceScope): boolean {
		return this.identity(existing, scope) === this.identity(input);
	}

	normalizeForSettings(source: string, scope: ResourceScope): string {
		const parsed = parseResourceSource(source);
		if (parsed.type !== "local") return source;
		return this.paths.relative(this.baseDir(scope), this.resolvePath(parsed.path)) || ".";
	}

	private getGlobalNpmRoot(): string {
		return this.locationFacts.getGlobalNpmRoot();
	}
}
