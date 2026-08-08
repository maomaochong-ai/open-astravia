import type { EventBus, ExtensionFactory, LoadExtensionsResult } from "../../extensions/index.js";
import type { Theme } from "../../modes/interactive/theme/theme.js";
import type { PromptTemplate } from "../prompts/index.js";
import type { Skill } from "../skills/index.js";
import type { ResourceDiagnostic } from "./diagnostics.js";
import type { ResourcePackageRuntime, ResourcePathMetadata, ResourceSettingsPort } from "./resource-source.js";

export interface ResourceExtensionPaths {
	skillPaths?: Array<{ path: string; metadata: ResourcePathMetadata }>;
	promptPaths?: Array<{ path: string; metadata: ResourcePathMetadata }>;
	themePaths?: Array<{ path: string; metadata: ResourcePathMetadata }>;
}

export interface SessionResourceRuntime {
	getExtensions(): LoadExtensionsResult;
	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
	getThemes(): { themes: Theme[]; diagnostics: ResourceDiagnostic[] };
	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
	getSystemPrompt(): string | undefined;
	getAppendSystemPrompt(): string[];
	getPathMetadata(): Map<string, ResourcePathMetadata>;
	extendResources(paths: ResourceExtensionPaths): void;
	setAdditionalSkillPaths(paths: string[]): void;
	setRuntimeSkillPaths(paths: string[]): void;
	setAdditionalExtensionPaths(paths: string[]): void;
	reloadSkills(): void;
	reload(): Promise<void>;
	refreshSkillsIfChanged(): boolean;
}

export interface SessionResourceRuntimeOptions {
	cwd: string;
	agentDir: string;
	packages: ResourcePackageRuntime;
	settings?: ResourceSettingsPort;
	eventBus?: EventBus;
	additionalExtensionPaths?: string[];
	additionalSkillPaths?: string[];
	additionalPromptTemplatePaths?: string[];
	additionalThemePaths?: string[];
	extensionFactories?: ExtensionFactory[];
	noExtensions?: boolean;
	noSkills?: boolean;
	noPromptTemplates?: boolean;
	noThemes?: boolean;
	includeAgentSkills?: boolean;
	systemPrompt?: string;
	appendSystemPrompt?: string;
	extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
	skillsOverride?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: Skill[];
		diagnostics: ResourceDiagnostic[];
	};
	promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
	themesOverride?: (base: { themes: Theme[]; diagnostics: ResourceDiagnostic[] }) => {
		themes: Theme[];
		diagnostics: ResourceDiagnostic[];
	};
	agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	systemPromptOverride?: (base: string | undefined) => string | undefined;
	appendSystemPromptOverride?: (base: string[]) => string[];
}
