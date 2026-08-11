import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME } from "../../config.js";
import { type GitSource, parseGitUrl } from "../../utils/git.js";
import type { ResourcePackageCommandPort, ResourceScope } from "../contracts/resource-source.js";

export interface NpmResourceSource {
	type: "npm";
	spec: string;
	name: string;
	pinned: boolean;
}

export interface LocalResourceSource {
	type: "local";
	path: string;
}

export type ParsedResourceSource = NpmResourceSource | GitSource | LocalResourceSource;

export function parseNpmResourceSpec(spec: string): { name: string; version?: string } {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
	if (!match) return { name: spec };
	return { name: match[1] ?? spec, version: match[2] };
}

export function parseResourceSource(source: string): ParsedResourceSource {
	if (source.startsWith("npm:")) {
		const spec = source.slice("npm:".length).trim();
		const { name, version } = parseNpmResourceSpec(spec);
		return { type: "npm", spec, name, pinned: Boolean(version) };
	}

	const trimmed = source.trim();
	const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]|^\\\\/.test(trimmed);
	const isLocalPathLike =
		trimmed.startsWith(".") ||
		trimmed.startsWith("/") ||
		trimmed === "~" ||
		trimmed.startsWith("~/") ||
		isWindowsAbsolutePath;
	if (isLocalPathLike) return { type: "local", path: source };

	return parseGitUrl(source) ?? { type: "local", path: source };
}

export class ResourcePackageLocations {
	private globalNpmRoot: string | undefined;

	constructor(
		readonly cwd: string,
		readonly agentDir: string,
		private readonly commands: ResourcePackageCommandPort,
	) {}

	resolvePath(input: string): string {
		return this.resolvePathFromBase(input, this.cwd);
	}

	resolvePathFromBase(input: string, baseDir: string): string {
		const trimmed = input.trim();
		if (trimmed === "~") return homedir();
		if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
		if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
		return resolve(baseDir, trimmed);
	}

	baseDir(scope: ResourceScope): string {
		if (scope === "project") return join(this.cwd, CONFIG_DIR_NAME);
		if (scope === "user") return this.agentDir;
		return this.cwd;
	}

	npmInstallRoot(scope: ResourceScope, temporary: boolean): string {
		if (temporary) return this.temporaryDir("npm");
		if (scope === "project") return join(this.cwd, CONFIG_DIR_NAME, "npm");
		return join(this.getGlobalNpmRoot(), "..");
	}

	npmInstallPath(source: NpmResourceSource, scope: ResourceScope): string {
		if (scope === "temporary") return join(this.temporaryDir("npm"), "node_modules", source.name);
		if (scope === "project") return join(this.cwd, CONFIG_DIR_NAME, "npm", "node_modules", source.name);
		return join(this.getGlobalNpmRoot(), source.name);
	}

	gitInstallPath(source: GitSource, scope: ResourceScope): string {
		if (scope === "temporary") return this.temporaryDir(`git-${source.host}`, source.path);
		if (scope === "project") return join(this.cwd, CONFIG_DIR_NAME, "git", source.host, source.path);
		return join(this.agentDir, "git", source.host, source.path);
	}

	gitInstallRoot(scope: ResourceScope): string | undefined {
		if (scope === "temporary") return undefined;
		if (scope === "project") return join(this.cwd, CONFIG_DIR_NAME, "git");
		return join(this.agentDir, "git");
	}

	temporaryDir(prefix: string, suffix?: string): string {
		const hash = createHash("sha256")
			.update(`${prefix}-${suffix ?? ""}`)
			.digest("hex")
			.slice(0, 8);
		return join(tmpdir(), "pi-extensions", prefix, hash, suffix ?? "");
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
		return relative(this.baseDir(scope), this.resolvePath(parsed.path)) || ".";
	}

	private getGlobalNpmRoot(): string {
		this.globalNpmRoot ??= this.commands.runSync("npm", ["root", "-g"]).trim();
		return this.globalNpmRoot;
	}
}
