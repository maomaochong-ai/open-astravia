import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getUserSkillsDir } from "../../config.js";
import type {
	ResolvedResourcePath,
	ResolvedResourcePaths,
	ResourceKind,
	ResourcePackageSource,
	ResourcePathMetadata,
	ResourceSettingsSnapshot,
} from "../contracts/resource-source.js";
import {
	collectAncestorAgentSkillEntries,
	collectAutoExtensionEntries,
	collectAutoPromptEntries,
	collectAutoSkillEntries,
	collectAutoThemeEntries,
	collectResourceFiles,
	readResourceManifest,
} from "./resource-discovery.js";
import {
	applyResourcePatterns,
	isResourceEnabledByOverrides,
	isResourcePattern,
	splitResourcePatterns,
} from "./resource-patterns.js";
import type { LocalResourceSource, ResourcePackageLocations } from "./source-spec.js";

type ResourceEntryState = { metadata: ResourcePathMetadata; enabled: boolean };
export type ResourceAccumulator = Record<ResourceKind, Map<string, ResourceEntryState>>;
type ResourceFilter = Exclude<ResourcePackageSource, string>;
const RESOURCE_KINDS: ResourceKind[] = ["extensions", "skills", "prompts", "themes"];

export class ResourceProjector {
	constructor(private readonly locations: ResourcePackageLocations) {}

	createAccumulator(): ResourceAccumulator {
		return { extensions: new Map(), skills: new Map(), prompts: new Map(), themes: new Map() };
	}

	toResolvedPaths(accumulator: ResourceAccumulator): ResolvedResourcePaths {
		const resolveEntries = (entries: Map<string, ResourceEntryState>): ResolvedResourcePath[] =>
			Array.from(entries, ([path, state]) => ({ path, ...state }));
		return {
			extensions: resolveEntries(accumulator.extensions),
			skills: resolveEntries(accumulator.skills),
			prompts: resolveEntries(accumulator.prompts),
			themes: resolveEntries(accumulator.themes),
		};
	}

	projectLocalSource(
		source: LocalResourceSource,
		accumulator: ResourceAccumulator,
		filter: ResourceFilter | undefined,
		metadata: ResourcePathMetadata,
		baseDir: string,
	): void {
		const resolved = this.locations.resolvePathFromBase(source.path, baseDir);
		if (!existsSync(resolved)) return;
		try {
			const stats = statSync(resolved);
			if (stats.isFile()) {
				metadata.baseDir = dirname(resolved);
				this.addResource(accumulator.extensions, resolved, metadata, true);
			} else if (stats.isDirectory()) {
				metadata.baseDir = resolved;
				if (!this.projectPackage(resolved, accumulator, filter, metadata)) {
					this.addResource(accumulator.extensions, resolved, metadata, true);
				}
			}
		} catch {}
	}

	projectPackage(
		packageRoot: string,
		accumulator: ResourceAccumulator,
		filter: ResourceFilter | undefined,
		metadata: ResourcePathMetadata,
	): boolean {
		if (filter) {
			for (const kind of RESOURCE_KINDS) {
				const patterns = filter[kind];
				if (patterns !== undefined)
					this.applyPackageFilter(packageRoot, patterns, kind, accumulator[kind], metadata);
				else this.collectDefaultResources(packageRoot, kind, accumulator[kind], metadata);
			}
			return true;
		}

		const manifest = readResourceManifest(packageRoot);
		if (manifest) {
			for (const kind of RESOURCE_KINDS) {
				this.addManifestEntries(manifest[kind], packageRoot, kind, accumulator[kind], metadata);
			}
			return true;
		}

		let foundConventionDirectory = false;
		for (const kind of RESOURCE_KINDS) {
			const dir = join(packageRoot, kind);
			if (!existsSync(dir)) continue;
			for (const path of collectResourceFiles(dir, kind)) this.addResource(accumulator[kind], path, metadata, true);
			foundConventionDirectory = true;
		}
		return foundConventionDirectory;
	}

	projectConfiguredPaths(
		accumulator: ResourceAccumulator,
		globalSettings: ResourceSettingsSnapshot,
		projectSettings: ResourceSettingsSnapshot,
		globalBaseDir: string,
		projectBaseDir: string,
	): void {
		for (const kind of RESOURCE_KINDS) {
			this.resolveLocalEntries(
				projectSettings[kind] ?? [],
				kind,
				accumulator[kind],
				{ source: "local", scope: "project", origin: "top-level" },
				projectBaseDir,
			);
			this.resolveLocalEntries(
				globalSettings[kind] ?? [],
				kind,
				accumulator[kind],
				{ source: "local", scope: "user", origin: "top-level" },
				globalBaseDir,
			);
		}
		this.addAutoDiscoveredResources(accumulator, globalSettings, projectSettings, globalBaseDir, projectBaseDir);
	}

	private collectDefaultResources(
		packageRoot: string,
		kind: ResourceKind,
		target: Map<string, ResourceEntryState>,
		metadata: ResourcePathMetadata,
	): void {
		const entries = readResourceManifest(packageRoot)?.[kind];
		if (entries) {
			this.addManifestEntries(entries, packageRoot, kind, target, metadata);
			return;
		}
		const dir = join(packageRoot, kind);
		if (existsSync(dir)) {
			for (const path of collectResourceFiles(dir, kind)) this.addResource(target, path, metadata, true);
		}
	}

	private applyPackageFilter(
		packageRoot: string,
		patterns: string[],
		kind: ResourceKind,
		target: Map<string, ResourceEntryState>,
		metadata: ResourcePathMetadata,
	): void {
		const allFiles = this.collectManifestFiles(packageRoot, kind);
		const enabled =
			patterns.length === 0 ? new Set<string>() : applyResourcePatterns(allFiles, patterns, packageRoot);
		for (const path of allFiles) this.addResource(target, path, metadata, enabled.has(path));
	}

	private collectManifestFiles(packageRoot: string, kind: ResourceKind): string[] {
		const entries = readResourceManifest(packageRoot)?.[kind];
		if (entries?.length) {
			const allFiles = this.collectFilesFromManifestEntries(entries, packageRoot, kind);
			const patterns = entries.filter(isResourcePattern);
			return patterns.length > 0 ? Array.from(applyResourcePatterns(allFiles, patterns, packageRoot)) : allFiles;
		}
		const conventionDir = join(packageRoot, kind);
		return existsSync(conventionDir) ? collectResourceFiles(conventionDir, kind) : [];
	}

	private addManifestEntries(
		entries: string[] | undefined,
		root: string,
		kind: ResourceKind,
		target: Map<string, ResourceEntryState>,
		metadata: ResourcePathMetadata,
	): void {
		if (!entries) return;
		const allFiles = this.collectFilesFromManifestEntries(entries, root, kind);
		const enabled = applyResourcePatterns(allFiles, entries.filter(isResourcePattern), root);
		for (const path of allFiles) if (enabled.has(path)) this.addResource(target, path, metadata, true);
	}

	private collectFilesFromManifestEntries(entries: string[], root: string, kind: ResourceKind): string[] {
		return this.collectFilesFromPaths(
			entries.filter((entry) => !isResourcePattern(entry)).map((entry) => resolve(root, entry)),
			kind,
		);
	}

	private resolveLocalEntries(
		entries: string[],
		kind: ResourceKind,
		target: Map<string, ResourceEntryState>,
		metadata: ResourcePathMetadata,
		baseDir: string,
	): void {
		if (entries.length === 0) return;
		const { plain, patterns } = splitResourcePatterns(entries);
		const paths = this.collectFilesFromPaths(
			plain.map((path) => this.locations.resolvePathFromBase(path, baseDir)),
			kind,
		);
		const enabled = applyResourcePatterns(paths, patterns, baseDir);
		for (const path of paths) this.addResource(target, path, metadata, enabled.has(path));
	}

	private addAutoDiscoveredResources(
		accumulator: ResourceAccumulator,
		globalSettings: ResourceSettingsSnapshot,
		projectSettings: ResourceSettingsSnapshot,
		globalBaseDir: string,
		projectBaseDir: string,
	): void {
		const projectMetadata: ResourcePathMetadata = {
			source: "auto",
			scope: "project",
			origin: "top-level",
			baseDir: projectBaseDir,
		};
		const userMetadata: ResourcePathMetadata = {
			source: "auto",
			scope: "user",
			origin: "top-level",
			baseDir: globalBaseDir,
		};
		const projectDirs = this.resourceDirs(projectBaseDir);
		const userDirs = this.resourceDirs(globalBaseDir);
		const add = (
			kind: ResourceKind,
			paths: string[],
			metadata: ResourcePathMetadata,
			overrides: string[],
			baseDir: string,
		): void => {
			for (const path of paths) {
				this.addResource(accumulator[kind], path, metadata, isResourceEnabledByOverrides(path, overrides, baseDir));
			}
		};
		add(
			"extensions",
			collectAutoExtensionEntries(projectDirs.extensions),
			projectMetadata,
			projectSettings.extensions ?? [],
			projectBaseDir,
		);
		add(
			"skills",
			[...collectAutoSkillEntries(projectDirs.skills), ...collectAncestorAgentSkillEntries(this.locations.cwd)],
			projectMetadata,
			projectSettings.skills ?? [],
			projectBaseDir,
		);
		add(
			"prompts",
			collectAutoPromptEntries(projectDirs.prompts),
			projectMetadata,
			projectSettings.prompts ?? [],
			projectBaseDir,
		);
		add(
			"themes",
			collectAutoThemeEntries(projectDirs.themes),
			projectMetadata,
			projectSettings.themes ?? [],
			projectBaseDir,
		);
		add(
			"extensions",
			collectAutoExtensionEntries(userDirs.extensions),
			userMetadata,
			globalSettings.extensions ?? [],
			globalBaseDir,
		);
		add(
			"skills",
			[...collectAutoSkillEntries(userDirs.skills), ...collectAutoSkillEntries(getUserSkillsDir())],
			userMetadata,
			globalSettings.skills ?? [],
			globalBaseDir,
		);
		add(
			"prompts",
			collectAutoPromptEntries(userDirs.prompts),
			userMetadata,
			globalSettings.prompts ?? [],
			globalBaseDir,
		);
		add("themes", collectAutoThemeEntries(userDirs.themes), userMetadata, globalSettings.themes ?? [], globalBaseDir);
	}

	private resourceDirs(baseDir: string): Record<ResourceKind, string> {
		return {
			extensions: join(baseDir, "extensions"),
			skills: join(baseDir, "skills"),
			prompts: join(baseDir, "prompts"),
			themes: join(baseDir, "themes"),
		};
	}

	private collectFilesFromPaths(paths: string[], kind: ResourceKind): string[] {
		const files: string[] = [];
		for (const path of paths) {
			if (!existsSync(path)) continue;
			try {
				const stats = statSync(path);
				if (stats.isFile()) files.push(path);
				else if (stats.isDirectory()) files.push(...collectResourceFiles(path, kind));
			} catch {}
		}
		return files;
	}

	private addResource(
		target: Map<string, ResourceEntryState>,
		path: string,
		metadata: ResourcePathMetadata,
		enabled: boolean,
	): void {
		if (path && !target.has(path)) target.set(path, { metadata, enabled });
	}
}
