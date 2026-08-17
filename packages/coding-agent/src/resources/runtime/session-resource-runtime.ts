import { CONFIG_DIR_NAME } from "../../config.js";
import {
	createExtensionEventBus,
	createExtensionRuntime,
	type EventBus,
	type LoadExtensionsResult,
} from "../../extensions/index.js";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { ResourceDiagnostic } from "../contracts/diagnostics.js";
import type {
	ResourceExtensionPaths,
	SessionResourceRuntime,
	SessionResourceRuntimeOptions,
} from "../contracts/resource-runtime.js";
import type { ResolvedResourcePath, ResourcePathMetadata } from "../contracts/resource-source.js";
import { isResourceEnabledByOverrides } from "../packages/resource-patterns.js";
import type { PromptTemplate } from "../prompts/index.js";
import type { Skill } from "../skills/index.js";
import { discoverPromptFile, loadProjectContextFiles, resolvePromptInput } from "./context-resources.js";
import { loadExtensionResources } from "./extension-resources.js";
import { loadPromptResources } from "./prompt-resource-state.js";
import { mergeResourcePaths, ResourceMetadataIndex, resolveResourcePath } from "./resource-state.js";
import { computeSkillsFingerprint, loadSkillResources } from "./skill-resource-state.js";
import { loadThemeResources } from "./theme-resources.js";

export function createSessionResourceRuntime(options: SessionResourceRuntimeOptions): SessionResourceRuntime {
	return new DefaultSessionResourceRuntime(options);
}

class DefaultSessionResourceRuntime implements SessionResourceRuntime {
	private readonly options: SessionResourceRuntimeOptions;
	private readonly metadata: ResourceMetadataIndex;
	private readonly eventBus: EventBus;
	private additionalExtensionPaths: string[];
	private additionalSkillPaths: string[];
	private runtimeSkillPaths: string[] = [];
	private extensionsResult: LoadExtensionsResult;
	private skills: Skill[] = [];
	private skillDiagnostics: ResourceDiagnostic[] = [];
	private prompts: PromptTemplate[] = [];
	private promptDiagnostics: ResourceDiagnostic[] = [];
	private themes: Theme[] = [];
	private themeDiagnostics: ResourceDiagnostic[] = [];
	private agentsFiles: Array<{ path: string; content: string }> = [];
	private systemPrompt: string | undefined;
	private appendSystemPrompt: string[] = [];
	private nonRuntimeSkillPaths: string[] = [];
	private lastSkillPaths: string[] = [];
	private lastPromptPaths: string[] = [];
	private lastThemePaths: string[] = [];
	private skillsFingerprint = "";
	private contextResourcesFingerprint = "";
	private skillOperation: Promise<void> = Promise.resolve();
	private promptOperation: Promise<void> = Promise.resolve();
	private themeOperation: Promise<void> = Promise.resolve();

	constructor(options: SessionResourceRuntimeOptions) {
		this.options = options;
		this.metadata = new ResourceMetadataIndex(options.resourceAccess.paths, options.cwd, options.agentDir);
		this.eventBus = options.eventBus ?? createExtensionEventBus();
		this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
		this.additionalSkillPaths = options.additionalSkillPaths ?? [];
		this.extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	}

	getExtensions(): LoadExtensionsResult {
		return this.extensionsResult;
	}

	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
		return { skills: [...this.skills], diagnostics: [...this.skillDiagnostics] };
	}

	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		return { prompts: [...this.prompts], diagnostics: [...this.promptDiagnostics] };
	}

	getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] } {
		return { themes: this.themes, diagnostics: this.themeDiagnostics };
	}

	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
		return { agentsFiles: this.agentsFiles };
	}

	getSystemPrompt(): string | undefined {
		return this.systemPrompt;
	}

	getAppendSystemPrompt(): string[] {
		return this.appendSystemPrompt;
	}

	getPathMetadata(): Map<string, ResourcePathMetadata> {
		return this.metadata.get();
	}

	setAdditionalSkillPaths(paths: string[], signal?: AbortSignal): Promise<void> {
		return this.enqueueSkillOperation(() => this.setAdditionalSkillPathsNow(paths, signal));
	}

	private async setAdditionalSkillPathsNow(paths: string[], signal?: AbortSignal): Promise<void> {
		const previousPaths = this.merge([], this.additionalSkillPaths);
		const nextPaths = this.merge([], paths);
		if (
			previousPaths.length === nextPaths.length &&
			previousPaths.every((path, index) => path === nextPaths[index])
		) {
			return;
		}
		const previous = new Set(previousPaths);
		this.additionalSkillPaths = nextPaths;
		this.nonRuntimeSkillPaths = this.merge(
			this.nonRuntimeSkillPaths.filter(
				(path) => !previous.has(this.options.resourceAccess.paths.resolve(this.options.cwd, path)),
			),
			this.additionalSkillPaths,
		);
		this.lastSkillPaths = this.merge(this.nonRuntimeSkillPaths, this.runtimeSkillPaths);
		await this.updateSkills(this.lastSkillPaths, [], signal);
		this.skillsFingerprint = await this.computeFingerprint(signal);
	}

	setRuntimeSkillPaths(paths: string[], signal?: AbortSignal): Promise<void> {
		return this.enqueueSkillOperation(() => this.setRuntimeSkillPathsNow(paths, signal));
	}

	private async setRuntimeSkillPathsNow(paths: string[], signal?: AbortSignal): Promise<void> {
		const nextPaths = this.merge([], paths);
		if (
			this.runtimeSkillPaths.length === nextPaths.length &&
			this.runtimeSkillPaths.every((path, index) => path === nextPaths[index])
		) {
			return;
		}
		this.runtimeSkillPaths = nextPaths;
		this.lastSkillPaths = this.merge(this.nonRuntimeSkillPaths, this.runtimeSkillPaths);
		await this.updateSkills(this.lastSkillPaths, [], signal);
		this.skillsFingerprint = await this.computeFingerprint(signal);
	}

	setAdditionalExtensionPaths(paths: string[]): void {
		this.additionalExtensionPaths = this.merge([], paths);
	}

	reloadSkills(signal?: AbortSignal): Promise<void> {
		return this.enqueueSkillOperation(() => this.reloadSkillsNow(signal));
	}

	private async reloadSkillsNow(signal?: AbortSignal): Promise<void> {
		await this.updateSkills(this.lastSkillPaths, [], signal);
		this.skillsFingerprint = await this.computeFingerprint(signal);
	}

	async extendResources(paths: ResourceExtensionPaths, signal?: AbortSignal): Promise<void> {
		const skills = this.normalizeExtensionPaths(paths.skillPaths ?? []);
		const prompts = this.normalizeExtensionPaths(paths.promptPaths ?? []);
		const themes = this.normalizeExtensionPaths(paths.themePaths ?? []);
		if (skills.length > 0) {
			await this.enqueueSkillOperation(async () => {
				this.nonRuntimeSkillPaths = this.merge(
					this.nonRuntimeSkillPaths,
					skills.map((entry) => entry.path),
				);
				this.lastSkillPaths = this.merge(this.nonRuntimeSkillPaths, this.runtimeSkillPaths);
				await this.updateSkills(this.lastSkillPaths, skills, signal);
				this.skillsFingerprint = await this.computeFingerprint(signal);
			});
		}
		if (prompts.length > 0) {
			await this.enqueuePromptOperation(async () => {
				const nextPaths = this.merge(
					this.lastPromptPaths,
					prompts.map((entry) => entry.path),
				);
				await this.updatePrompts(nextPaths, prompts, signal);
				this.lastPromptPaths = nextPaths;
			});
		}
		if (themes.length > 0) {
			await this.enqueueThemeOperation(async () => {
				const nextPaths = this.merge(
					this.lastThemePaths,
					themes.map((entry) => entry.path),
				);
				await this.updateThemes(nextPaths, themes, signal);
				this.lastThemePaths = nextPaths;
			});
		}
	}

	async reload(): Promise<void> {
		const resolved = await this.options.packages.resolve();
		const additional = await this.options.packages.resolveAdditionalSources(this.additionalExtensionPaths, {
			temporary: true,
		});
		this.metadata.reset();
		const enabledExtensions = this.enabledPaths(resolved.extensions);
		const enabledSkills = await Promise.all(
			this.metadata.enabled(resolved.skills).map((resource) => this.resolveSkillPath(resource)),
		);
		const enabledPrompts = this.enabledPaths(resolved.prompts);
		const enabledThemes = this.enabledPaths(resolved.themes);
		const additionalExtensions = this.enabledPaths(additional.extensions);
		const additionalSkills = this.enabledPaths(additional.skills);
		const additionalPrompts = this.enabledPaths(additional.prompts);
		const additionalThemes = this.enabledPaths(additional.themes);

		const extensionPaths = this.options.noExtensions
			? additionalExtensions
			: this.merge(enabledExtensions, additionalExtensions);
		const extensionsResult = await loadExtensionResources({
			paths: extensionPaths,
			cwd: this.options.cwd,
			resourceAccess: this.options.resourceAccess,
			factoryLoader: this.options.extensionFactoryLoader,
			commandExecutor: this.options.extensionCommandExecutor,
			eventBus: this.eventBus,
			factories: this.options.extensionFactories ?? [],
		});
		this.extensionsResult = this.options.extensionsOverride
			? this.options.extensionsOverride(extensionsResult)
			: extensionsResult;

		const skillPaths = this.options.noSkills
			? this.merge(additionalSkills, this.additionalSkillPaths)
			: this.merge(
					[...enabledSkills, ...additionalSkills, this.options.skillLocations.sceneDir],
					this.additionalSkillPaths,
				);
		await this.enqueueSkillOperation(async () => {
			this.nonRuntimeSkillPaths = skillPaths;
			this.lastSkillPaths = this.merge(this.nonRuntimeSkillPaths, this.runtimeSkillPaths);
			await this.updateSkills(this.lastSkillPaths);
			this.skillsFingerprint = await this.computeFingerprint();
		});
		const promptPaths = this.options.noPromptTemplates
			? this.merge(additionalPrompts, this.options.additionalPromptTemplatePaths ?? [])
			: this.merge([...enabledPrompts, ...additionalPrompts], this.options.additionalPromptTemplatePaths ?? []);
		await this.enqueuePromptOperation(async () => {
			await this.updatePrompts(promptPaths);
			this.lastPromptPaths = promptPaths;
		});
		const themePaths = this.options.noThemes
			? this.merge(additionalThemes, this.options.additionalThemePaths ?? [])
			: this.merge([...enabledThemes, ...additionalThemes], this.options.additionalThemePaths ?? []);
		await this.enqueueThemeOperation(async () => {
			await this.updateThemes(themePaths);
			this.lastThemePaths = themePaths;
		});
		for (const extension of this.extensionsResult.extensions) this.metadata.addDefault(extension.path);
		await this.updateContextResources();
	}

	refreshSkillsIfChanged(signal?: AbortSignal): Promise<boolean> {
		return this.enqueueSkillOperation(() => this.refreshSkillsIfChangedNow(signal));
	}

	private async refreshSkillsIfChangedNow(signal?: AbortSignal): Promise<boolean> {
		const fingerprint = await this.computeFingerprint(signal);
		if (fingerprint === this.skillsFingerprint) return false;
		await this.updateSkills(this.lastSkillPaths, [], signal);
		this.skillsFingerprint = fingerprint;
		return true;
	}

	async refreshContextResourcesIfChanged(signal?: AbortSignal): Promise<boolean> {
		const resources = await this.readContextResources(signal);
		const fingerprint = JSON.stringify(resources);
		if (fingerprint === this.contextResourcesFingerprint) return false;
		this.applyContextResources(resources);
		this.contextResourcesFingerprint = fingerprint;
		return true;
	}

	private enabledPaths(resources: ResolvedResourcePath[]): string[] {
		return this.metadata.enabled(resources).map((resource) => resource.path);
	}

	private async resolveSkillPath(resource: ResolvedResourcePath): Promise<string> {
		if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") return resource.path;
		try {
			if ((await this.options.resourceAccess.files.stat(resource.path))?.kind !== "directory") return resource.path;
		} catch {
			return resource.path;
		}
		const skillFile = this.options.resourceAccess.paths.join(resource.path, "SKILL.md");
		if ((await this.options.resourceAccess.files.stat(skillFile))?.kind === "file") {
			this.metadata.apply([{ path: skillFile, metadata: resource.metadata }], []);
			return skillFile;
		}
		return resource.path;
	}

	private async updateSkills(
		resourcePaths: string[],
		extensionPaths: Array<{ path: string; metadata: ResourcePathMetadata }> = [],
		signal?: AbortSignal,
	): Promise<void> {
		const pathPort = this.options.resourceAccess.paths;
		const resolvedPaths = this.options.noSkills
			? resourcePaths
			: this.merge(
					[
						pathPort.resolve(this.options.cwd, CONFIG_DIR_NAME, "skills"),
						pathPort.join(this.options.agentDir, "skills"),
					],
					resourcePaths,
				);
		const result = await loadSkillResources({
			resourceAccess: this.options.resourceAccess,
			cwd: this.options.cwd,
			agentDir: this.options.agentDir,
			sceneDir: this.options.skillLocations.sceneDir,
			managedSkillsDir: this.options.skillLocations.managedSkillsDir,
			manifestPath: this.options.skillLocations.manifestPath,
			paths: resolvedPaths,
			includeAgentSkills: this.options.includeAgentSkills ?? true,
			disabled: this.options.noSkills ?? false,
			signal,
			override: this.options.skillsOverride,
		});
		this.skills = this.filterDefaultSkillOverrides(result.skills).map((skill) =>
			Object.freeze({ ...skill, sceneTasks: Object.freeze([...skill.sceneTasks]) }),
		);
		this.skillDiagnostics = result.diagnostics;
		this.metadata.apply(
			extensionPaths,
			this.skills.map((skill) => skill.filePath),
		);
		for (const skill of this.skills) this.metadata.addDefault(skill.filePath);
	}

	private filterDefaultSkillOverrides(skills: Skill[]): Skill[] {
		if (!this.options.settings) return skills;
		const projectSettings = this.options.settings.getProjectSettings();
		const globalSettings = this.options.settings.getGlobalSettings();
		const pathPort = this.options.resourceAccess.paths;
		const projectBaseDir = pathPort.resolve(this.options.cwd, CONFIG_DIR_NAME);
		return skills.filter((skill) => {
			if (skill.source === "project") {
				return isResourceEnabledByOverrides(pathPort, skill.filePath, projectSettings.skills ?? [], projectBaseDir);
			}
			if (skill.source === "user") {
				return isResourceEnabledByOverrides(
					pathPort,
					skill.filePath,
					globalSettings.skills ?? [],
					this.options.agentDir,
				);
			}
			return true;
		});
	}

	private async updatePrompts(
		paths: string[],
		extensionPaths: Array<{ path: string; metadata: ResourcePathMetadata }> = [],
		signal?: AbortSignal,
	): Promise<void> {
		const result = await loadPromptResources({
			resourceAccess: this.options.resourceAccess,
			cwd: this.options.cwd,
			agentDir: this.options.agentDir,
			paths,
			disabled: this.options.noPromptTemplates ?? false,
			signal,
			override: this.options.promptsOverride,
		});
		this.prompts = result.prompts.map((prompt) => Object.freeze({ ...prompt }));
		this.promptDiagnostics = [...result.diagnostics];
		this.metadata.apply(
			extensionPaths,
			this.prompts.map((prompt) => prompt.filePath),
		);
		for (const prompt of this.prompts) this.metadata.addDefault(prompt.filePath);
	}

	private async updateThemes(
		paths: string[],
		extensionPaths: Array<{ path: string; metadata: ResourcePathMetadata }> = [],
		signal?: AbortSignal,
	): Promise<void> {
		let result =
			this.options.noThemes && paths.length === 0
				? { themes: [], diagnostics: [] }
				: await loadThemeResources({
						resourceAccess: this.options.resourceAccess,
						paths,
						cwd: this.options.cwd,
						parse: this.options.themeParser,
						signal,
					});
		result = this.options.themesOverride ? this.options.themesOverride(result) : result;
		this.themes = result.themes;
		this.themeDiagnostics = result.diagnostics;
		const sourcePaths = this.themes.flatMap((theme) => (theme.sourcePath ? [theme.sourcePath] : []));
		this.metadata.apply(extensionPaths, sourcePaths);
		for (const path of sourcePaths) this.metadata.addDefault(path);
	}

	private async updateContextResources(): Promise<void> {
		const resources = await this.readContextResources();
		this.applyContextResources(resources);
		this.contextResourcesFingerprint = JSON.stringify(resources);
	}

	private async readContextResources(signal?: AbortSignal): Promise<ContextResourcesSnapshot> {
		const access = this.options.resourceAccess;
		const agentsFiles = await loadProjectContextFiles(access, this.options.cwd, this.options.agentDir, signal);
		const systemPrompt = await resolvePromptInput(
			access,
			this.options.systemPrompt ??
				(await discoverPromptFile(access, this.options.cwd, this.options.agentDir, "SYSTEM.md", signal)),
			"system prompt",
			signal,
		);
		const append = await resolvePromptInput(
			access,
			this.options.appendSystemPrompt ??
				(await discoverPromptFile(access, this.options.cwd, this.options.agentDir, "APPEND_SYSTEM.md", signal)),
			"append system prompt",
			signal,
		);
		return { agentsFiles, systemPrompt, appendSystemPrompt: append ? [append] : [] };
	}

	private applyContextResources(resources: ContextResourcesSnapshot): void {
		const agentsFiles = { agentsFiles: resources.agentsFiles };
		this.agentsFiles = (this.options.agentsFilesOverride?.(agentsFiles) ?? agentsFiles).agentsFiles;
		this.systemPrompt = this.options.systemPromptOverride
			? this.options.systemPromptOverride(resources.systemPrompt)
			: resources.systemPrompt;
		const appendPrompts = resources.appendSystemPrompt;
		this.appendSystemPrompt = this.options.appendSystemPromptOverride?.(appendPrompts) ?? appendPrompts;
	}

	private normalizeExtensionPaths(
		entries: Array<{ path: string; metadata: ResourcePathMetadata }>,
	): Array<{ path: string; metadata: ResourcePathMetadata }> {
		return entries.map((entry) => ({
			path: resolveResourcePath(this.options.resourceAccess.paths, this.options.cwd, entry.path),
			metadata: entry.metadata,
		}));
	}

	private merge(primary: string[], additional: string[]): string[] {
		return mergeResourcePaths(this.options.resourceAccess.paths, this.options.cwd, primary, additional);
	}

	private computeFingerprint(signal?: AbortSignal): Promise<string> {
		return computeSkillsFingerprint(this.options.resourceAccess, this.lastSkillPaths, {
			cwd: this.options.cwd,
			agentDir: this.options.agentDir,
			includeDefaults: !(this.options.noSkills ?? false),
			includeAgentSkills: this.options.includeAgentSkills ?? true,
			manifestPath: this.options.skillLocations.manifestPath,
			signal,
		});
	}

	private enqueueSkillOperation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.skillOperation.then(operation, operation);
		this.skillOperation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private enqueuePromptOperation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.promptOperation.then(operation, operation);
		this.promptOperation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private enqueueThemeOperation<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.themeOperation.then(operation, operation);
		this.themeOperation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

interface ContextResourcesSnapshot {
	readonly agentsFiles: Array<{ path: string; content: string }>;
	readonly systemPrompt: string | undefined;
	readonly appendSystemPrompt: string[];
}
