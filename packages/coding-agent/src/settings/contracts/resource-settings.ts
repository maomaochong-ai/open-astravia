import type { PackageSource } from "./settings-document.js";

export interface ResourceSettingsPort {
	getTheme(): string | undefined;
	setTheme(theme: string): void;
	getPackages(): PackageSource[];
	setPackages(packages: PackageSource[]): void;
	setProjectPackages(packages: PackageSource[]): void;
	getExtensionPaths(): string[];
	setExtensionPaths(paths: string[]): void;
	setProjectExtensionPaths(paths: string[]): void;
	getSkillPaths(): string[];
	setSkillPaths(paths: string[]): void;
	setProjectSkillPaths(paths: string[]): void;
	getPromptTemplatePaths(): string[];
	setPromptTemplatePaths(paths: string[]): void;
	setProjectPromptTemplatePaths(paths: string[]): void;
	getThemePaths(): string[];
	setThemePaths(paths: string[]): void;
	setProjectThemePaths(paths: string[]): void;
	getEnableSkillCommands(): boolean;
	setEnableSkillCommands(enabled: boolean): void;
}
