import type { ResourceAccessPort } from "../contracts/resource-access.js";
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
	type ResourceDiscoveryOptions,
	readResourceManifest,
} from "./resource-discovery.js";
import type { ResourcePackageLocations } from "./resource-package-locations.js";
import {
	applyResourcePatterns,
	isResourceEnabledByOverrides,
	isResourcePattern,
	splitResourcePatterns,
} from "./resource-patterns.js";
import type { LocalResourceSource } from "./source-spec.js";

type ResourceEntryState = { metadata: ResourcePathMetadata; enabled: boolean };
export type ResourceAccumulator = Record<ResourceKind, Map<string, ResourceEntryState>>;
type ResourceFilter = Exclude<ResourcePackageSource, string>;
const RESOURCE_KINDS: ResourceKind[] = ["extensions", "skills", "prompts", "themes"];

export class ResourceProjector {
	constructor(
		private readonly locations: ResourcePackageLocations,
		private readonly resourceAccess: ResourceAccessPort,
		private readonly managedSkillsDir: string,
	) {}

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

	async projectLocalSource(
		source: LocalResourceSource,
		accumulator: ResourceAccumulator,
		filter: ResourceFilter | undefined,
		metadata: ResourcePathMetadata,
		baseDir: string,
	): Promise<void> {
		const resolved = this.locations.resolvePathFromBase(source.path, baseDir);
		const stats = await this.stat(resolved);
		if (!stats) return;
		if (stats.kind === "file") {
			metadata.baseDir = this.resourceAccess.paths.dirname(resolved);
			this.addResource(accumulator.extensions, resolved, metadata, true);
		} else if (stats.kind === "directory") {
			metadata.baseDir = resolved;
			if (!(await this.projectPackage(resolved, accumulator, filter, metadata))) {
				this.addResource(accumulator.extensions, resolved, metadata, true);
			}
		}
	}

	async projectPackage(
		packageRoot: string,
		accumulator: ResourceAccumulator,
		filter: ResourceFilter | undefined,
		metadata: ResourcePathMetadata,
	): Promise<boolean> {
		if (filter) {
			for (const kind of RESOURCE_KINDS) {
				const patterns = filter[kind];
				if (patterns !== undefined) {
					await this.applyPackageFilter(packageRoot, patterns, kind, accumulator[kind], metadata);
				} else {
					await this.collectDefaultResources(packageRoot, kind, accumulator[kind], metadata);
				}
			}
			return true;
		}

		const manifest = await this.readManifest(packageRoot);
		if (manifest) {
			for (const kind of RESOURCE_KINDS) {
				await this.addManifestEntries(manifest[kind], packageRoot, kind, accumulator[kind], metadata);
			}
			return true;
		}

		let foundConventionDirectory = false;
		for (const kind of RESOURCE_KINDS) {
			const dir = this.resourceAccess.paths.join(packageRoot, kind);
			if (!(await this.stat(dir))) continue;
			for (const path of await this.collectResourceFiles(dir, kind)) {
				this.addResource(accumulator[kind], path, metadata, true);
			}
			foundConventionDirectory = true;
		}
		return foundConventionDirectory;
	}

	async projectConfiguredPaths(
		accumulator: ResourceAccumulator,
		globalSettings: ResourceSettingsSnapshot,
		projectSettings: ResourceSettingsSnapshot,
		globalBaseDir: string,
		projectBaseDir: string,
	): Promise<void> {
		for (const kind of RESOURCE_KINDS) {
			await this.resolveLocalEntries(
				projectSettings[kind] ?? [],
				kind,
				accumulator[kind],
				{ source: "local", scope: "project", origin: "top-level" },
				projectBaseDir,
			);
			await this.resolveLocalEntries(
				globalSettings[kind] ?? [],
				kind,
				accumulator[kind],
				{ source: "local", scope: "user", origin: "top-level" },
				globalBaseDir,
			);
		}
		await this.addAutoDiscoveredResources(
			accumulator,
			globalSettings,
			projectSettings,
			globalBaseDir,
			projectBaseDir,
		);
	}

	private async collectDefaultResources(
		packageRoot: string,
		kind: ResourceKind,
		target: Map<string, ResourceEntryState>,
		metadata: ResourcePathMetadata,
	): Promise<void> {
		const entries = (await this.readManifest(packageRoot))?.[kind];
		if (entries) {
			await this.addManifestEntries(entries, packageRoot, kind, target, metadata);
			return;
		}
		const dir = this.resourceAccess.paths.join(packageRoot, kind);
		if (!(await this.stat(dir))) return;
		for (const path of await this.collectResourceFiles(dir, kind)) this.addResource(target, path, metadata, true);
	}

	private async applyPackageFilter(
		packageRoot: string,
		patterns: string[],
		kind: ResourceKind,
		target: Map<string, ResourceEntryState>,
		metadata: ResourcePathMetadata,
	): Promise<void> {
		const allFiles = await this.collectManifestFiles(packageRoot, kind);
		const enabled =
			patterns.length === 0
				? new Set<string>()
				: applyResourcePatterns(this.resourceAccess.paths, allFiles, patterns, packageRoot);
		for (const path of allFiles) this.addResource(target, path, metadata, enabled.has(path));
	}

	private async collectManifestFiles(packageRoot: string, kind: ResourceKind): Promise<string[]> {
		const entries = (await this.readManifest(packageRoot))?.[kind];
		if (entries?.length) {
			const allFiles = await this.collectFilesFromManifestEntries(entries, packageRoot, kind);
			const patterns = entries.filter(isResourcePattern);
			return patterns.length > 0
				? Array.from(applyResourcePatterns(this.resourceAccess.paths, allFiles, patterns, packageRoot))
				: allFiles;
		}
		const conventionDir = this.resourceAccess.paths.join(packageRoot, kind);
		return (await this.stat(conventionDir)) ? this.collectResourceFiles(conventionDir, kind) : [];
	}

	private async addManifestEntries(
		entries: string[] | undefined,
		root: string,
		kind: ResourceKind,
		target: Map<string, ResourceEntryState>,
		metadata: ResourcePathMetadata,
	): Promise<void> {
		if (!entries) return;
		const allFiles = await this.collectFilesFromManifestEntries(entries, root, kind);
		const enabled = applyResourcePatterns(
			this.resourceAccess.paths,
			allFiles,
			entries.filter(isResourcePattern),
			root,
		);
		for (const path of allFiles) if (enabled.has(path)) this.addResource(target, path, metadata, true);
	}

	private collectFilesFromManifestEntries(entries: string[], root: string, kind: ResourceKind): Promise<string[]> {
		return this.collectFilesFromPaths(
			entries
				.filter((entry) => !isResourcePattern(entry))
				.map((entry) => this.resourceAccess.paths.resolve(root, entry)),
			kind,
		);
	}

	private async resolveLocalEntries(
		entries: string[],
		kind: ResourceKind,
		target: Map<string, ResourceEntryState>,
		metadata: ResourcePathMetadata,
		baseDir: string,
	): Promise<void> {
		if (entries.length === 0) return;
		const { plain, patterns } = splitResourcePatterns(entries);
		const paths = await this.collectFilesFromPaths(
			plain.map((path) => this.locations.resolvePathFromBase(path, baseDir)),
			kind,
		);
		const enabled = applyResourcePatterns(this.resourceAccess.paths, paths, patterns, baseDir);
		for (const path of paths) this.addResource(target, path, metadata, enabled.has(path));
	}

	private async addAutoDiscoveredResources(
		accumulator: ResourceAccumulator,
		globalSettings: ResourceSettingsSnapshot,
		projectSettings: ResourceSettingsSnapshot,
		globalBaseDir: string,
		projectBaseDir: string,
	): Promise<void> {
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
		const add = async (
			kind: ResourceKind,
			paths: Promise<string[]>,
			metadata: ResourcePathMetadata,
			overrides: string[],
			baseDir: string,
		): Promise<void> => {
			for (const path of await paths) {
				this.addResource(
					accumulator[kind],
					path,
					metadata,
					isResourceEnabledByOverrides(this.resourceAccess.paths, path, overrides, baseDir),
				);
			}
		};
		const discoveryOptions = { resourceAccess: this.resourceAccess } satisfies ResourceDiscoveryOptions;
		await add(
			"extensions",
			collectAutoExtensionEntries(discoveryOptions, projectDirs.extensions),
			projectMetadata,
			projectSettings.extensions ?? [],
			projectBaseDir,
		);
		await add(
			"skills",
			Promise.all([
				collectAutoSkillEntries(discoveryOptions, projectDirs.skills),
				collectAncestorAgentSkillEntries(discoveryOptions, this.locations.cwd),
			]).then(([skills, ancestors]) => [...skills, ...ancestors]),
			projectMetadata,
			projectSettings.skills ?? [],
			projectBaseDir,
		);
		await add(
			"prompts",
			collectAutoPromptEntries(discoveryOptions, projectDirs.prompts),
			projectMetadata,
			projectSettings.prompts ?? [],
			projectBaseDir,
		);
		await add(
			"themes",
			collectAutoThemeEntries(discoveryOptions, projectDirs.themes),
			projectMetadata,
			projectSettings.themes ?? [],
			projectBaseDir,
		);
		await add(
			"extensions",
			collectAutoExtensionEntries(discoveryOptions, userDirs.extensions),
			userMetadata,
			globalSettings.extensions ?? [],
			globalBaseDir,
		);
		await add(
			"skills",
			Promise.all([
				collectAutoSkillEntries(discoveryOptions, userDirs.skills),
				collectAutoSkillEntries(discoveryOptions, this.managedSkillsDir),
			]).then(([skills, managed]) => [...skills, ...managed]),
			userMetadata,
			globalSettings.skills ?? [],
			globalBaseDir,
		);
		await add(
			"prompts",
			collectAutoPromptEntries(discoveryOptions, userDirs.prompts),
			userMetadata,
			globalSettings.prompts ?? [],
			globalBaseDir,
		);
		await add(
			"themes",
			collectAutoThemeEntries(discoveryOptions, userDirs.themes),
			userMetadata,
			globalSettings.themes ?? [],
			globalBaseDir,
		);
	}

	private resourceDirs(baseDir: string): Record<ResourceKind, string> {
		return {
			extensions: this.resourceAccess.paths.join(baseDir, "extensions"),
			skills: this.resourceAccess.paths.join(baseDir, "skills"),
			prompts: this.resourceAccess.paths.join(baseDir, "prompts"),
			themes: this.resourceAccess.paths.join(baseDir, "themes"),
		};
	}

	private async collectFilesFromPaths(paths: string[], kind: ResourceKind): Promise<string[]> {
		const files: string[] = [];
		const discoveryOptions = { resourceAccess: this.resourceAccess } satisfies ResourceDiscoveryOptions;
		for (const path of paths) {
			const stats = await this.stat(path);
			if (!stats) continue;
			if (stats.kind === "file") files.push(path);
			else if (stats.kind === "directory") files.push(...(await collectResourceFiles(discoveryOptions, path, kind)));
		}
		return files;
	}

	private collectResourceFiles(path: string, kind: ResourceKind): Promise<string[]> {
		return collectResourceFiles({ resourceAccess: this.resourceAccess }, path, kind);
	}

	private readManifest(packageRoot: string) {
		return readResourceManifest({ resourceAccess: this.resourceAccess }, packageRoot);
	}

	private async stat(path: string) {
		try {
			return await this.resourceAccess.files.stat(path);
		} catch {
			return undefined;
		}
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
