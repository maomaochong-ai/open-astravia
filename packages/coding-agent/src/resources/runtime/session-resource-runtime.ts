import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME, getSceneDir } from "../../config.js";
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
import {
	computeSkillsFingerprint,
	loadPromptResources,
	loadSkillResources,
	mergeResourcePaths,
	ResourceMetadataIndex,
	resolveResourcePath,
} from "./resource-state.js";
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

	constructor(options: SessionResourceRuntimeOptions) {
		this.options = options;
		this.metadata = new ResourceMetadataIndex(options.cwd, options.agentDir);
		this.eventBus = options.eventBus ?? createExtensionEventBus();
		this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
		this.additionalSkillPaths = options.additionalSkillPaths ?? [];
		this.extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	}

	getExtensions(): LoadExtensionsResult {
		return this.extensionsResult;
	}

	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
		return { skills: this.skills, diagnostics: this.skillDiagnostics };
	}

	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		return { prompts: this.prompts, diagnostics: this.promptDiagnostics };
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

	setAdditionalSkillPaths(paths: string[]): void {
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
			this.nonRuntimeSkillPaths.filter((path) => !previous.has(resolve(path))),
			this.additionalSkillPaths,
		);
		this.lastSkillPaths = this.merge(this.nonRuntimeSkillPaths, this.runtimeSkillPaths);
		this.updateSkills(this.lastSkillPaths);
		this.skillsFingerprint = this.computeFingerprint();
	}

	setRuntimeSkillPaths(paths: string[]): void {
		const nextPaths = this.merge([], paths);
		if (
			this.runtimeSkillPaths.length === nextPaths.length &&
			this.runtimeSkillPaths.every((path, index) => path === nextPaths[index])
		) {
			return;
		}
		this.runtimeSkillPaths = nextPaths;
		this.lastSkillPaths = this.merge(this.nonRuntimeSkillPaths, this.runtimeSkillPaths);
		this.updateSkills(this.lastSkillPaths);
		this.skillsFingerprint = this.computeFingerprint();
	}

	setAdditionalExtensionPaths(paths: string[]): void {
		this.additionalExtensionPaths = this.merge([], paths);
	}

	reloadSkills(): void {
		this.updateSkills(this.lastSkillPaths);
		this.skillsFingerprint = this.computeFingerprint();
	}

	extendResources(paths: ResourceExtensionPaths): void {
		const skills = this.normalizeExtensionPaths(paths.skillPaths ?? []);
		const prompts = this.normalizeExtensionPaths(paths.promptPaths ?? []);
		const themes = this.normalizeExtensionPaths(paths.themePaths ?? []);
		if (skills.length > 0) {
			this.nonRuntimeSkillPaths = this.merge(
				this.nonRuntimeSkillPaths,
				skills.map((entry) => entry.path),
			);
			this.lastSkillPaths = this.merge(this.nonRuntimeSkillPaths, this.runtimeSkillPaths);
			this.updateSkills(this.lastSkillPaths, skills);
			this.skillsFingerprint = this.computeFingerprint();
		}
		if (prompts.length > 0) {
			this.lastPromptPaths = this.merge(
				this.lastPromptPaths,
				prompts.map((entry) => entry.path),
			);
			this.updatePrompts(this.lastPromptPaths, prompts);
		}
		if (themes.length > 0) {
			this.lastThemePaths = this.merge(
				this.lastThemePaths,
				themes.map((entry) => entry.path),
			);
			this.updateThemes(this.lastThemePaths, themes);
		}
	}

	async reload(): Promise<void> {
		const resolved = await this.options.packages.resolve();
		const additional = await this.options.packages.resolveAdditionalSources(this.additionalExtensionPaths, {
			temporary: true,
		});
		this.metadata.reset();
		const enabledExtensions = this.enabledPaths(resolved.extensions);
		const enabledSkills = this.metadata.enabled(resolved.skills).map((resource) => this.resolveSkillPath(resource));
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
			eventBus: this.eventBus,
			factories: this.options.extensionFactories ?? [],
		});
		this.extensionsResult = this.options.extensionsOverride
			? this.options.extensionsOverride(extensionsResult)
			: extensionsResult;

		const skillPaths = this.options.noSkills
			? this.merge(additionalSkills, this.additionalSkillPaths)
			: this.merge([...enabledSkills, ...additionalSkills, getSceneDir()], this.additionalSkillPaths);
		this.nonRuntimeSkillPaths = skillPaths;
		this.lastSkillPaths = this.merge(this.nonRuntimeSkillPaths, this.runtimeSkillPaths);
		this.updateSkills(this.lastSkillPaths);
		const promptPaths = this.options.noPromptTemplates
			? this.merge(additionalPrompts, this.options.additionalPromptTemplatePaths ?? [])
			: this.merge([...enabledPrompts, ...additionalPrompts], this.options.additionalPromptTemplatePaths ?? []);
		this.lastPromptPaths = promptPaths;
		this.updatePrompts(promptPaths);
		const themePaths = this.options.noThemes
			? this.merge(additionalThemes, this.options.additionalThemePaths ?? [])
			: this.merge([...enabledThemes, ...additionalThemes], this.options.additionalThemePaths ?? []);
		this.lastThemePaths = themePaths;
		this.updateThemes(themePaths);
		this.skillsFingerprint = this.computeFingerprint();
		for (const extension of this.extensionsResult.extensions) this.metadata.addDefault(extension.path);
		this.updateContextResources();
	}

	refreshSkillsIfChanged(): boolean {
		const fingerprint = this.computeFingerprint();
		if (fingerprint === this.skillsFingerprint) return false;
		this.skillsFingerprint = fingerprint;
		this.updateSkills(this.lastSkillPaths);
		return true;
	}

	private enabledPaths(resources: ResolvedResourcePath[]): string[] {
		return this.metadata.enabled(resources).map((resource) => resource.path);
	}

	private resolveSkillPath(resource: ResolvedResourcePath): string {
		if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") return resource.path;
		try {
			if (!statSync(resource.path).isDirectory()) return resource.path;
		} catch {
			return resource.path;
		}
		const skillFile = join(resource.path, "SKILL.md");
		if (existsSync(skillFile)) {
			this.metadata.apply([{ path: skillFile, metadata: resource.metadata }], []);
			return skillFile;
		}
		return resource.path;
	}

	private updateSkills(
		paths: string[],
		extensionPaths: Array<{ path: string; metadata: ResourcePathMetadata }> = [],
	): void {
		const resolvedPaths = this.options.noSkills
			? paths
			: this.merge(
					[resolve(this.options.cwd, CONFIG_DIR_NAME, "skills"), join(this.options.agentDir, "skills")],
					paths,
				);
		const result = loadSkillResources({
			cwd: this.options.cwd,
			agentDir: this.options.agentDir,
			paths: resolvedPaths,
			includeAgentSkills: this.options.includeAgentSkills ?? true,
			disabled: this.options.noSkills ?? false,
			override: this.options.skillsOverride,
		});
		this.skills = this.filterDefaultSkillOverrides(result.skills);
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
		const projectBaseDir = resolve(this.options.cwd, CONFIG_DIR_NAME);
		return skills.filter((skill) => {
			if (skill.source === "project") {
				return isResourceEnabledByOverrides(skill.filePath, projectSettings.skills ?? [], projectBaseDir);
			}
			if (skill.source === "user") {
				return isResourceEnabledByOverrides(skill.filePath, globalSettings.skills ?? [], this.options.agentDir);
			}
			return true;
		});
	}

	private updatePrompts(
		paths: string[],
		extensionPaths: Array<{ path: string; metadata: ResourcePathMetadata }> = [],
	): void {
		const result = loadPromptResources({
			cwd: this.options.cwd,
			agentDir: this.options.agentDir,
			paths,
			disabled: this.options.noPromptTemplates ?? false,
			override: this.options.promptsOverride,
		});
		this.prompts = result.prompts;
		this.promptDiagnostics = result.diagnostics;
		this.metadata.apply(
			extensionPaths,
			this.prompts.map((prompt) => prompt.filePath),
		);
		for (const prompt of this.prompts) this.metadata.addDefault(prompt.filePath);
	}

	private updateThemes(
		paths: string[],
		extensionPaths: Array<{ path: string; metadata: ResourcePathMetadata }> = [],
	): void {
		let result =
			this.options.noThemes && paths.length === 0
				? { themes: [], diagnostics: [] }
				: loadThemeResources(paths, this.options.cwd);
		result = this.options.themesOverride ? this.options.themesOverride(result) : result;
		this.themes = result.themes;
		this.themeDiagnostics = result.diagnostics;
		const sourcePaths = this.themes.flatMap((theme) => (theme.sourcePath ? [theme.sourcePath] : []));
		this.metadata.apply(extensionPaths, sourcePaths);
		for (const path of sourcePaths) this.metadata.addDefault(path);
	}

	private updateContextResources(): void {
		const agentsFiles = { agentsFiles: loadProjectContextFiles(this.options.cwd, this.options.agentDir) };
		this.agentsFiles = (this.options.agentsFilesOverride?.(agentsFiles) ?? agentsFiles).agentsFiles;
		const systemPrompt = resolvePromptInput(
			this.options.systemPrompt ?? discoverPromptFile(this.options.cwd, this.options.agentDir, "SYSTEM.md"),
			"system prompt",
		);
		this.systemPrompt = this.options.systemPromptOverride
			? this.options.systemPromptOverride(systemPrompt)
			: systemPrompt;
		const append = resolvePromptInput(
			this.options.appendSystemPrompt ??
				discoverPromptFile(this.options.cwd, this.options.agentDir, "APPEND_SYSTEM.md"),
			"append system prompt",
		);
		const appendPrompts = append ? [append] : [];
		this.appendSystemPrompt = this.options.appendSystemPromptOverride?.(appendPrompts) ?? appendPrompts;
	}

	private normalizeExtensionPaths(
		entries: Array<{ path: string; metadata: ResourcePathMetadata }>,
	): Array<{ path: string; metadata: ResourcePathMetadata }> {
		return entries.map((entry) => ({
			path: resolveResourcePath(this.options.cwd, entry.path),
			metadata: entry.metadata,
		}));
	}

	private merge(primary: string[], additional: string[]): string[] {
		return mergeResourcePaths(this.options.cwd, primary, additional);
	}

	private computeFingerprint(): string {
		return computeSkillsFingerprint(this.lastSkillPaths, {
			cwd: this.options.cwd,
			agentDir: this.options.agentDir,
			includeDefaults: !(this.options.noSkills ?? false),
			includeAgentSkills: this.options.includeAgentSkills ?? true,
		});
	}
}
