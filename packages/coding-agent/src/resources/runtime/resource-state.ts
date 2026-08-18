import { CONFIG_DIR_NAME } from "../../identity.js";
import type { ResourcePathPort } from "../contracts/resource-access.js";
import type { ResolvedResourcePath, ResourcePathMetadata } from "../contracts/resource-source.js";

export function resolveResourcePath(paths: ResourcePathPort, cwd: string, path: string): string {
	const trimmed = path.trim();
	const expanded =
		trimmed === "~"
			? paths.homeDirectory()
			: trimmed.startsWith("~/")
				? paths.join(paths.homeDirectory(), trimmed.slice(2))
				: trimmed.startsWith("~")
					? paths.join(paths.homeDirectory(), trimmed.slice(1))
					: trimmed;
	return paths.resolve(cwd, expanded);
}

export function mergeResourcePaths(
	paths: ResourcePathPort,
	cwd: string,
	primary: string[],
	additional: string[],
): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();
	for (const path of [...primary, ...additional]) {
		const resolved = resolveResourcePath(paths, cwd, path);
		if (!seen.has(resolved)) {
			seen.add(resolved);
			merged.push(resolved);
		}
	}
	return merged;
}

export class ResourceMetadataIndex {
	private entries = new Map<string, ResourcePathMetadata>();

	constructor(
		private readonly paths: ResourcePathPort,
		private readonly cwd: string,
		private readonly agentDir: string,
	) {}

	reset(): void {
		this.entries = new Map();
	}

	get(): Map<string, ResourcePathMetadata> {
		return this.entries;
	}

	enabled(resources: ResolvedResourcePath[]): ResolvedResourcePath[] {
		for (const resource of resources)
			if (!this.entries.has(resource.path)) this.entries.set(resource.path, resource.metadata);
		return resources.filter((resource) => resource.enabled);
	}

	apply(extensionPaths: Array<{ path: string; metadata: ResourcePathMetadata }>, resourcePaths: string[]): void {
		const normalized = extensionPaths.map((entry) => ({
			path: this.paths.resolve(this.cwd, entry.path),
			metadata: entry.metadata,
		}));
		for (const entry of normalized) if (!this.entries.has(entry.path)) this.entries.set(entry.path, entry.metadata);
		for (const resourcePath of resourcePaths) {
			const path = this.paths.resolve(this.cwd, resourcePath);
			if (this.entries.has(path) || this.entries.has(resourcePath)) continue;
			const match = normalized.find(
				(entry) => path === entry.path || path.startsWith(`${entry.path}${this.paths.separator}`),
			);
			if (match) this.entries.set(path, match.metadata);
		}
	}

	addDefault(filePath: string): void {
		if (!filePath || filePath.startsWith("<")) return;
		const path = this.paths.resolve(this.cwd, filePath);
		if (this.entries.has(path) || this.entries.has(filePath)) return;
		for (const [scope, base] of [
			["user", this.agentDir],
			["project", this.paths.join(this.cwd, CONFIG_DIR_NAME)],
		] as const) {
			for (const kind of ["skills", "prompts", "themes", "extensions"]) {
				const root = this.paths.resolve(base, kind);
				if (
					path === root ||
					path.startsWith(root.endsWith(this.paths.separator) ? root : `${root}${this.paths.separator}`)
				) {
					this.entries.set(path, { source: "local", scope, origin: "top-level" });
					return;
				}
			}
		}
	}
}
