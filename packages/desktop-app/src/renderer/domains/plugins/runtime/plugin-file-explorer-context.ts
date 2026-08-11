import type { InstalledPlugin } from "@preload/api";
import type {
	Disposable,
	PluginContext,
	PluginFileExplorerContextMenuContribution,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerToolbarContribution,
} from "@vetta-org/plugin-sdk";
import {
	getPluginFileExplorerSelection,
	getPluginFileExplorerWorkspaceRoots,
	onPluginFileExplorerFilesChanged,
	onPluginFileExplorerSelectionChanged,
	refreshPluginFileExplorer,
	revealPluginFileExplorerPath,
} from "./plugin-file-explorer-host";
import type { PluginLocalContributions } from "./plugin-local-contributions";
import { createPluginPermissionApi as createPermissionApi } from "./plugin-permissions";

export interface CreatePluginFileExplorerApiOptions {
	plugin: InstalledPlugin;
	contributions: PluginLocalContributions;
	onChanged: () => void;
	disposers: Array<() => void>;
}

export function createPluginFileExplorerApi({
	plugin,
	contributions,
	onChanged,
	disposers,
}: CreatePluginFileExplorerApiOptions): PluginContext["fileExplorer"] {
	const { fileExplorerContextMenuActions, fileExplorerToolbarActions, fileExplorerDecorationProviders } =
		contributions;
	const registerFileExplorerContextMenuAction = (
		contribution: PluginFileExplorerContextMenuContribution,
	): Disposable => {
		createPermissionApi(plugin).require("ui.file-explorer.context-menu");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("File explorer context-menu action id is required");
		}
		if (typeof contribution.label !== "string" || contribution.label.trim().length === 0) {
			throw new Error("File explorer context-menu action label is required");
		}
		if (typeof contribution.run !== "function") {
			throw new Error("File explorer context-menu action handler is required");
		}
		const normalized: PluginFileExplorerContextMenuContribution = {
			...contribution,
			id: `${plugin.id}:${contribution.id.trim()}`,
			label: contribution.label.trim(),
		};
		fileExplorerContextMenuActions.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = fileExplorerContextMenuActions.indexOf(normalized);
				if (index >= 0) fileExplorerContextMenuActions.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerFileExplorerToolbarAction = (contribution: PluginFileExplorerToolbarContribution): Disposable => {
		createPermissionApi(plugin).require("ui.file-explorer.toolbar");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("File explorer toolbar action id is required");
		}
		if (typeof contribution.label !== "string" || contribution.label.trim().length === 0) {
			throw new Error("File explorer toolbar action label is required");
		}
		if (typeof contribution.run !== "function") {
			throw new Error("File explorer toolbar action handler is required");
		}
		const normalized: PluginFileExplorerToolbarContribution = {
			...contribution,
			id: `${plugin.id}:${contribution.id.trim()}`,
			label: contribution.label.trim(),
		};
		fileExplorerToolbarActions.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = fileExplorerToolbarActions.indexOf(normalized);
				if (index >= 0) fileExplorerToolbarActions.splice(index, 1);
				onChanged();
			},
		};
	};
	const registerFileExplorerDecorationProvider = (contribution: PluginFileExplorerDecorationProvider): Disposable => {
		createPermissionApi(plugin).require("ui.file-explorer.decorations");
		if (typeof contribution.id !== "string" || contribution.id.trim().length === 0) {
			throw new Error("File explorer decoration provider id is required");
		}
		if (typeof contribution.provideDecoration !== "function") {
			throw new Error("File explorer decoration provider is required");
		}
		const normalized: PluginFileExplorerDecorationProvider = {
			...contribution,
			id: `${plugin.id}:${contribution.id.trim()}`,
		};
		fileExplorerDecorationProviders.push(normalized);
		onChanged();
		return {
			dispose: () => {
				const index = fileExplorerDecorationProviders.indexOf(normalized);
				if (index >= 0) fileExplorerDecorationProviders.splice(index, 1);
				onChanged();
			},
		};
	};
	return {
		getWorkspaceRoots: () => {
			createPermissionApi(plugin).require("workspace.read");
			return getPluginFileExplorerWorkspaceRoots();
		},
		getSelection: () => {
			createPermissionApi(plugin).require("workspace.read");
			return getPluginFileExplorerSelection();
		},
		reveal: (path, options) => {
			createPermissionApi(plugin).require("workspace.read");
			return revealPluginFileExplorerPath(path, options);
		},
		refresh: (path) => {
			createPermissionApi(plugin).require("workspace.read");
			return refreshPluginFileExplorer(path);
		},
		onDidChangeSelection: (listener) => {
			createPermissionApi(plugin).require("workspace.read");
			const handle = onPluginFileExplorerSelectionChanged(listener);
			disposers.push(() => handle.dispose());
			return handle;
		},
		onDidChangeFiles: (listener) => {
			createPermissionApi(plugin).require("workspace.read");
			const handle = onPluginFileExplorerFilesChanged(listener);
			disposers.push(() => handle.dispose());
			return handle;
		},
		registerContextMenuAction: registerFileExplorerContextMenuAction,
		registerToolbarAction: registerFileExplorerToolbarAction,
		registerDecorationProvider: registerFileExplorerDecorationProvider,
	};
}
