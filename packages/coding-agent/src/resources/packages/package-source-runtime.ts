import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "../../config.js";
import type {
	MissingResourceSourceAction,
	ResolvedResourcePaths,
	ResourcePackageCommandPort,
	ResourcePackageProgressEvent,
	ResourcePackageProgressListener,
	ResourcePackageRegistryPort,
	ResourcePackageRuntime,
	ResourcePackageSource,
	ResourcePathMetadata,
	ResourceScope,
	ResourceSettingsPort,
} from "../contracts/resource-source.js";
import {
	isResourcePackageOffline,
	NodeResourcePackageCommands,
	NpmResourcePackageRegistry,
} from "./package-effects.js";
import { ResourcePackageLifecycle } from "./package-lifecycle.js";
import { type ResourceAccumulator, ResourceProjector } from "./resource-projection.js";
import { type ParsedResourceSource, parseResourceSource, ResourcePackageLocations } from "./source-spec.js";

export interface ResourcePackageRuntimeOptions {
	cwd: string;
	agentDir: string;
	settings: ResourceSettingsPort;
	commands?: ResourcePackageCommandPort;
	registry?: ResourcePackageRegistryPort;
}

export function createResourcePackageRuntime(options: ResourcePackageRuntimeOptions): ResourcePackageRuntime {
	return new DefaultResourcePackageRuntime(options);
}

class DefaultResourcePackageRuntime implements ResourcePackageRuntime {
	private readonly settings: ResourceSettingsPort;
	private readonly locations: ResourcePackageLocations;
	private readonly lifecycle: ResourcePackageLifecycle;
	private readonly projector: ResourceProjector;
	private progressListener: ResourcePackageProgressListener | undefined;

	constructor(options: ResourcePackageRuntimeOptions) {
		const commands = options.commands ?? new NodeResourcePackageCommands();
		this.settings = options.settings;
		this.locations = new ResourcePackageLocations(options.cwd, options.agentDir, commands);
		this.lifecycle = new ResourcePackageLifecycle(
			this.locations,
			commands,
			options.registry ?? new NpmResourcePackageRegistry(),
		);
		this.projector = new ResourceProjector(this.locations);
	}

	setProgressListener(listener: ResourcePackageProgressListener | undefined): void {
		this.progressListener = listener;
	}

	addSource(source: string, options?: { local?: boolean }): boolean {
		const scope: ResourceScope = options?.local ? "project" : "user";
		const snapshot = scope === "project" ? this.settings.getProjectSettings() : this.settings.getGlobalSettings();
		const packages = snapshot.packages ?? [];
		if (packages.some((existing) => this.sourcesMatch(existing, source, scope))) return false;
		const next = [...packages, this.locations.normalizeForSettings(source, scope)];
		if (scope === "project") this.settings.setProjectPackages(next);
		else this.settings.setPackages(next);
		return true;
	}

	removeSource(source: string, options?: { local?: boolean }): boolean {
		const scope: ResourceScope = options?.local ? "project" : "user";
		const snapshot = scope === "project" ? this.settings.getProjectSettings() : this.settings.getGlobalSettings();
		const packages = snapshot.packages ?? [];
		const next = packages.filter((existing) => !this.sourcesMatch(existing, source, scope));
		if (next.length === packages.length) return false;
		if (scope === "project") this.settings.setProjectPackages(next);
		else this.settings.setPackages(next);
		return true;
	}

	getInstalledPath(source: string, scope: "user" | "project"): string | undefined {
		return this.lifecycle.getInstalledPath(parseResourceSource(source), scope);
	}

	async resolve(onMissing?: (source: string) => Promise<MissingResourceSourceAction>): Promise<ResolvedResourcePaths> {
		const accumulator = this.projector.createAccumulator();
		const globalSettings = this.settings.getGlobalSettings();
		const projectSettings = this.settings.getProjectSettings();
		const sources = this.dedupeSources([
			...(projectSettings.packages ?? []).map((source) => ({ source, scope: "project" as const })),
			...(globalSettings.packages ?? []).map((source) => ({ source, scope: "user" as const })),
		]);
		await this.resolveSources(sources, accumulator, onMissing);
		const globalBaseDir = this.locations.agentDir;
		const projectBaseDir = join(this.locations.cwd, CONFIG_DIR_NAME);
		this.projector.projectConfiguredPaths(
			accumulator,
			globalSettings,
			projectSettings,
			globalBaseDir,
			projectBaseDir,
		);
		return this.projector.toResolvedPaths(accumulator);
	}

	async resolveAdditionalSources(
		sources: string[],
		options?: { local?: boolean; temporary?: boolean },
	): Promise<ResolvedResourcePaths> {
		const accumulator = this.projector.createAccumulator();
		const scope: ResourceScope = options?.temporary ? "temporary" : options?.local ? "project" : "user";
		await this.resolveSources(
			sources.map((source) => ({ source, scope })),
			accumulator,
		);
		return this.projector.toResolvedPaths(accumulator);
	}

	async install(source: string, options?: { local?: boolean }): Promise<void> {
		const scope: ResourceScope = options?.local ? "project" : "user";
		await this.withProgress("install", source, `Installing ${source}...`, () =>
			this.lifecycle.install(parseResourceSource(source), scope),
		);
	}

	async remove(source: string, options?: { local?: boolean }): Promise<void> {
		const scope: ResourceScope = options?.local ? "project" : "user";
		await this.withProgress("remove", source, `Removing ${source}...`, () =>
			this.lifecycle.remove(parseResourceSource(source), scope),
		);
	}

	async update(source?: string): Promise<void> {
		if (isResourcePackageOffline()) return;
		const identity = source ? this.locations.identity(source) : undefined;
		for (const [scope, packages] of [
			["user", this.settings.getGlobalSettings().packages ?? []],
			["project", this.settings.getProjectSettings().packages ?? []],
		] as const) {
			for (const resourceSource of packages) {
				const sourceString = this.sourceString(resourceSource);
				if (identity && this.locations.identity(sourceString, scope) !== identity) continue;
				const parsed = parseResourceSource(sourceString);
				if (parsed.type === "local" || parsed.pinned) continue;
				await this.withProgress("update", sourceString, `Updating ${sourceString}...`, () =>
					this.lifecycle.update(parsed, scope),
				);
			}
		}
	}

	private async resolveSources(
		sources: Array<{ source: ResourcePackageSource; scope: ResourceScope }>,
		accumulator: ResourceAccumulator,
		onMissing?: (source: string) => Promise<MissingResourceSourceAction>,
	): Promise<void> {
		for (const entry of sources) {
			const sourceString = this.sourceString(entry.source);
			const filter = typeof entry.source === "object" ? entry.source : undefined;
			const parsed = parseResourceSource(sourceString);
			const metadata: ResourcePathMetadata = { source: sourceString, scope: entry.scope, origin: "package" };
			if (parsed.type === "local") {
				this.projector.projectLocalSource(
					parsed,
					accumulator,
					filter,
					metadata,
					this.locations.baseDir(entry.scope),
				);
				continue;
			}

			const installedPath =
				parsed.type === "npm"
					? this.locations.npmInstallPath(parsed, entry.scope)
					: this.locations.gitInstallPath(parsed, entry.scope);
			const wasInstalled = existsSync(installedPath);
			const needsInstall =
				!wasInstalled || (parsed.type === "npm" && (await this.lifecycle.needsNpmInstall(parsed, installedPath)));
			if (needsInstall && !(await this.installMissing(parsed, entry.scope, sourceString, onMissing))) continue;
			if (
				parsed.type === "git" &&
				entry.scope === "temporary" &&
				!parsed.pinned &&
				!isResourcePackageOffline() &&
				wasInstalled
			) {
				await this.withProgress("pull", sourceString, `Refreshing ${sourceString}...`, () =>
					this.lifecycle.refreshTemporaryGit(parsed),
				).catch(() => {});
			}
			metadata.baseDir = installedPath;
			this.projector.projectPackage(installedPath, accumulator, filter, metadata);
		}
	}

	private async installMissing(
		parsed: ParsedResourceSource,
		scope: ResourceScope,
		source: string,
		onMissing?: (source: string) => Promise<MissingResourceSourceAction>,
	): Promise<boolean> {
		if (isResourcePackageOffline()) return false;
		if (onMissing) {
			const action = await onMissing(source);
			if (action === "skip") return false;
			if (action === "error") throw new Error(`Missing source: ${source}`);
		}
		await this.lifecycle.install(parsed, scope, scope === "temporary");
		return true;
	}

	private async withProgress(
		action: ResourcePackageProgressEvent["action"],
		source: string,
		message: string,
		operation: () => Promise<void>,
	): Promise<void> {
		this.progressListener?.({ type: "start", action, source, message });
		try {
			await operation();
			this.progressListener?.({ type: "complete", action, source });
		} catch (error) {
			this.progressListener?.({
				type: "error",
				action,
				source,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	private sourceString(source: ResourcePackageSource): string {
		return typeof source === "string" ? source : source.source;
	}

	private sourcesMatch(existing: ResourcePackageSource, input: string, scope: ResourceScope): boolean {
		return this.locations.matchSettingsSource(this.sourceString(existing), input, scope);
	}

	private dedupeSources(
		sources: Array<{ source: ResourcePackageSource; scope: ResourceScope }>,
	): Array<{ source: ResourcePackageSource; scope: ResourceScope }> {
		const seen = new Map<string, { source: ResourcePackageSource; scope: ResourceScope }>();
		for (const entry of sources) {
			const identity = this.locations.identity(this.sourceString(entry.source), entry.scope);
			const existing = seen.get(identity);
			if (!existing || (entry.scope === "project" && existing.scope === "user")) seen.set(identity, entry);
		}
		return Array.from(seen.values());
	}
}
