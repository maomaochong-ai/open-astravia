import type { InstalledPlugin } from "@preload/api";
import { resolvePluginContributionIcon } from "@shared/lib/plugin-icon";
import type {
	Disposable,
	PluginContext,
	PluginFileExplorerContextMenuContribution,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerToolbarContribution,
	PluginFileIconTheme,
} from "@vetta-org/plugin-sdk";
import {
	getPluginFileExplorerSelection,
	getPluginFileExplorerWorkspaceRoots,
	onPluginFileExplorerFilesChanged,
	onPluginFileExplorerSelectionChanged,
	refreshPluginFileExplorer,
	revealPluginFileExplorerPath,
} from "./plugin-file-explorer-host";
import { validateFileExplorerWhen, validateFileIconTheme } from "./plugin-file-explorer-validation";
import type { PluginLocalContributions, ResolvedFileExplorerDecorationProvider } from "./plugin-local-contributions";
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
			when: validateFileExplorerWhen(contribution.when),
			id: `${plugin.id}:${contribution.id.trim()}`,
			label: contribution.label.trim(),
			icon: resolvePluginContributionIcon(contribution.icon, plugin.iconUrl),
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
			icon: resolvePluginContributionIcon(contribution.icon, plugin.iconUrl),
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
		if (contribution.priority !== undefined && !Number.isFinite(contribution.priority))
			throw new Error("Invalid decoration priority");
		if (
			contribution.onDidChangeDecorations !== undefined &&
			typeof contribution.onDidChangeDecorations !== "function"
		)
			throw new Error("Invalid decoration change event");
		const normalized: ResolvedFileExplorerDecorationProvider = {
			...contribution,
			when: validateFileExplorerWhen(contribution.when),
			changedEntries: new Map(),
			id: `${plugin.id}:${contribution.id.trim()}`,
		};
		let disposed = false;
		const subscription = contribution.onDidChangeDecorations?.((entries) => {
			if (disposed) return;
			if (entries === undefined) normalized.changedEntries.clear();
			else {
				if (!Array.isArray(entries)) throw new Error("Invalid decoration change entries");
				for (const entry of entries) {
					if (
						!entry ||
						typeof entry.path !== "string" ||
						typeof entry.name !== "string" ||
						typeof entry.isDirectory !== "boolean" ||
						!Number.isFinite(entry.size) ||
						!Number.isFinite(entry.modifiedAt)
					)
						throw new Error("Invalid decoration change entry");
				}
				for (const entry of entries) normalized.changedEntries.set(entry.path, { ...entry });
			}
			onChanged();
		});
		if (contribution.onDidChangeDecorations && (!subscription || typeof subscription.dispose !== "function"))
			throw new Error("Decoration change subscription must be disposable");
		fileExplorerDecorationProviders.push(normalized);
		onChanged();
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			subscription?.dispose();
			normalized.changedEntries.clear();
			const index = fileExplorerDecorationProviders.indexOf(normalized);
			if (index >= 0) fileExplorerDecorationProviders.splice(index, 1);
			onChanged();
		};
		disposers.push(dispose);
		return { dispose };
	};
	const registerIconTheme = (contribution: PluginFileIconTheme): Disposable => {
		createPermissionApi(plugin).require("ui.file-explorer.decorations");
		const theme = validateFileIconTheme(contribution);
		theme.id = `${plugin.id}:${theme.id}`;
		if (contributions.fileIconThemes.some((item) => item.id === theme.id))
			throw new Error("Duplicate file icon theme id");
		contributions.fileIconThemes.push(theme);
		onChanged();
		const dispose = () => {
			const index = contributions.fileIconThemes.indexOf(theme);
			if (index < 0) return;
			contributions.fileIconThemes.splice(index, 1);
			onChanged();
		};
		disposers.push(dispose);
		return { dispose };
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
		registerIconTheme,
	};
}
