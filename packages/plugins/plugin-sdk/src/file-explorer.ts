import type { ReactNode } from "react";
import type { Disposable } from "./disposable.js";

/** Metadata exposed by the host file explorer. Reading contents still requires `fs.read`. */
export interface PluginFileExplorerEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size: number;
	modifiedAt: number;
}

export interface PluginWorkspaceRoot {
	name: string;
	path: string;
}

/** Declarative matcher shared by menu actions and decorations. */
export interface PluginFileExplorerWhen {
	resourceType?: "file" | "directory";
	/** Lower-case extensions without a leading dot. Matching is case-insensitive. */
	extensions?: readonly string[];
	/** Exact basenames. Matching is case-insensitive. */
	fileNames?: readonly string[];
}

export interface PluginFileExplorerActionContext {
	entry: PluginFileExplorerEntry;
	workspaceRoot: PluginWorkspaceRoot | null;
}

export interface PluginFileExplorerContextMenuContribution {
	id: string;
	label: string;
	/** Action icon. Omit to inherit the plugin's `plugin.json#icon`. */
	icon?: ReactNode;
	when?: PluginFileExplorerWhen;
	/** Lower values render first. Defaults to 100. */
	order?: number;
	run(context: PluginFileExplorerActionContext): void | Promise<void>;
}

export interface PluginFileExplorerToolbarContext {
	workspaceRoot: PluginWorkspaceRoot;
	selection: readonly PluginFileExplorerEntry[];
}

export interface PluginFileExplorerToolbarContribution {
	id: string;
	label: string;
	/** Action icon. Omit to inherit the plugin's `plugin.json#icon`. */
	icon?: ReactNode;
	/** Lower values render first. Defaults to 100. */
	order?: number;
	run(context: PluginFileExplorerToolbarContext): void | Promise<void>;
}

export interface PluginFileExplorerDecoration {
	/** Replaces the host's default file/folder icon. */
	icon?: ReactNode;
	/** Compact status text rendered after the filename. Keep to one or two characters. */
	badge?: string;
	tooltip?: string;
	/** Host theme token, never arbitrary CSS. */
	color?: "foreground" | "muted" | "accent" | "success" | "warning" | "error";
	faded?: boolean;
	strikethrough?: boolean;
	/** Apply status to parent directories inside the active workspace. */
	propagate?: boolean;
}

export interface PluginFileExplorerDecorationProvider {
	id: string;
	when?: PluginFileExplorerWhen;
	/** Higher values win when multiple providers return a decoration. Defaults to 0. */
	priority?: number;
	/** Announce changed entries (including unexpanded descendants), or undefined to invalidate all. */
	onDidChangeDecorations?: (listener: (entries?: readonly PluginFileExplorerEntry[]) => void) => Disposable;
	provideDecoration(
		entry: PluginFileExplorerEntry,
	): PluginFileExplorerDecoration | null;
}

/** Declarative associations; values reference iconDefinitions. Exact names are case-insensitive. */
export interface PluginFileIconAssociations {
	file?: string;
	folder?: string;
	folderExpanded?: string;
	fileNames?: Readonly<Record<string, string>>;
	fileExtensions?: Readonly<Record<string, string>>;
	folderNames?: Readonly<Record<string, string>>;
	folderNamesExpanded?: Readonly<Record<string, string>>;
}

export interface PluginFileIconTheme extends PluginFileIconAssociations {
	id: string;
	label: string;
	iconDefinitions: Readonly<Record<string, ReactNode>>;
	light?: PluginFileIconAssociations;
	dark?: PluginFileIconAssociations;
	highContrast?: PluginFileIconAssociations;
}

export type PluginFileExplorerChange =
	| { type: "changed" | "created" | "deleted"; path: string }
	| { type: "moved"; path: string; oldPath: string };

export interface PluginFileExplorerRevealOptions {
	/** Select the revealed entry. Defaults to true. */
	select?: boolean;
	/** Move DOM focus to the row after revealing it. Defaults to false. */
	focus?: boolean;
}

export interface PluginFileExplorerApi {
	getWorkspaceRoots(): readonly PluginWorkspaceRoot[];
	getSelection(): readonly PluginFileExplorerEntry[];
	reveal(path: string, options?: PluginFileExplorerRevealOptions): Promise<void>;
	refresh(path?: string): Promise<void>;
	onDidChangeSelection(listener: (selection: readonly PluginFileExplorerEntry[]) => void): Disposable;
	onDidChangeFiles(listener: (changes: readonly PluginFileExplorerChange[]) => void): Disposable;
	registerContextMenuAction(contribution: PluginFileExplorerContextMenuContribution): Disposable;
	registerToolbarAction(contribution: PluginFileExplorerToolbarContribution): Disposable;
	registerDecorationProvider(contribution: PluginFileExplorerDecorationProvider): Disposable;
	/** Requires ui.file-explorer.decorations. Users explicitly select one theme. */
	registerIconTheme(contribution: PluginFileIconTheme): Disposable;
}
