import { basename } from "node:path";
import { dialog, type MessageBoxOptions, type MessageBoxReturnValue } from "electron";
import { logAbilityInstallFailed, logAbilityInstallStarted } from "../abilities/ability-lifecycle-log.js";
import { recordAppMonitorEvent } from "../app-monitor/app-monitor-service.js";
import { mainT } from "../i18n/index.js";
import { getMainWindow, showMainWindow } from "../window-manager.js";
import { applyPluginSetup, installPluginFromPath, readPluginPackageFromPath } from "./plugin-catalog.js";
import { readPluginManifestFromArchive } from "./plugin-package.js";
import { PluginPackageOpenService } from "./plugin-package-open-service.js";

export { PluginPackageOpenService } from "./plugin-package-open-service.js";

function messageBoxOptions() {
	const window = getMainWindow();
	return window && !window.isDestroyed() ? window : undefined;
}

async function showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
	const window = messageBoxOptions();
	return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

export function createDesktopPluginPackageOpenService(): PluginPackageOpenService {
	return new PluginPackageOpenService({
		inspect: async (filePath) => readPluginManifestFromArchive(await readPluginPackageFromPath(filePath)),
		confirm: async (filePath, manifest) => {
			const permissions = manifest.permissions ?? [];
			const commands = manifest.commands ?? [];
			const detail = mainT("pluginPackage.confirmDetail", {
				file: basename(filePath),
				id: manifest.id,
				version: manifest.version,
				permissions: permissions.length > 0 ? permissions.join("\n") : mainT("pluginPackage.none"),
				commands: commands.length > 0 ? commands.join("\n") : mainT("pluginPackage.none"),
			});
			const result = await showMessageBox({
				type: "question",
				title: mainT("pluginPackage.confirmTitle"),
				message: mainT("pluginPackage.confirmMessage", { name: manifest.name, version: manifest.version }),
				detail,
				buttons: [mainT("pluginPackage.install"), mainT("pluginPackage.cancel")],
				defaultId: 0,
				cancelId: 1,
				noLink: true,
			});
			return result.response === 0;
		},
		install: async (filePath, manifest) => {
			const artifactName = basename(filePath);
			const logContext = {
				abilityType: "plugin" as const,
				abilityId: manifest.id,
				version: manifest.version,
				installMode: "manual-package" as const,
				artifactKind: artifactName.toLowerCase().endsWith(".vettapkg")
					? ("vettapkg" as const)
					: ("legacy-zip" as const),
				artifactName,
			};
			logAbilityInstallStarted(logContext);
			const installed = await installPluginFromPath(filePath, {
				source: "archive",
				enable: false,
				grantedPermissions: manifest.permissions ?? [],
			});
			try {
				recordAppMonitorEvent(
					{
						type: "resource.lifecycle",
						resourceKind: "plugin",
						resourceId: installed.id,
						operation: installed.installedAt === installed.updatedAt ? "installed" : "updated",
						source: "archive",
					},
					logContext,
				);
			} catch {
				// Monitoring and logging must not affect a completed installation.
			}
			return applyPluginSetup(installed.id, {
				enabled: true,
				grantedPermissions: manifest.permissions ?? [],
				grantedCommands: manifest.commands ?? [],
			});
		},
		notifyInstalled: async (plugin) => {
			await showMessageBox({
				type: "info",
				title: mainT("pluginPackage.installedTitle"),
				message: mainT("pluginPackage.installedMessage", { name: plugin.name, version: plugin.activeVersion }),
				buttons: [mainT("pluginPackage.done")],
			});
		},
		notifyError: async (filePath, error, manifest) => {
			const artifactName = basename(filePath);
			logAbilityInstallFailed(
				{
					abilityType: "plugin",
					...(manifest ? { abilityId: manifest.id, version: manifest.version } : {}),
					installMode: "manual-package",
					artifactKind: "vettapkg",
					artifactName,
				},
				error,
			);
			await showMessageBox({
				type: "error",
				title: mainT("pluginPackage.failedTitle"),
				message: mainT("pluginPackage.failedMessage", { file: basename(filePath) }),
				detail: error instanceof Error ? error.message : String(error),
				buttons: [mainT("pluginPackage.done")],
			});
		},
		revealApp: showMainWindow,
	});
}
