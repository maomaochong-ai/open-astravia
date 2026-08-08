import { getWorkbenchCommand, getWorkbenchPlugins, withWorkbenchFs } from "./runtime";
import { joinPath, readJson, type ProjectInfo, resolveWorkbenchRoot } from "./project";

export interface ApplyPluginOptions {
	project: ProjectInfo;
	/** When set, skip list() lookup for workbench scripts. */
	workbenchRoot?: string;
	/**
	 * Force build-and-pack even if a zip already exists.
	 * Reinstall paths always force so permissions/commands land in the package.
	 */
	forceBuild?: boolean;
	/**
	 * After install, reload the whole Vetta renderer so host permission tables,
	 * settings schema, and every plugin remote re-hydrate from a cold start.
	 * Default false for first-time「应用到 Vetta」; true for「重新安装」.
	 */
	refreshApp?: boolean;
	/** Start / restart dev watch after install (ignored when refreshApp reloads). */
	startHotReload?: boolean;
}

/**
 * Build (optional) → installFromPath → enable → grant → optional hot reload / full app refresh.
 * Shared by panel buttons and the reinstall message card.
 */
export async function applyPluginToVetta(options: ApplyPluginOptions): Promise<{ zipPath: string }> {
	const { project, forceBuild = false, refreshApp = false, startHotReload = true } = options;
	const workbenchRoot = options.workbenchRoot ?? (await resolveWorkbenchRoot());
	const command = getWorkbenchCommand();
	const plugins = getWorkbenchPlugins();

	let zip = project.zipPath;
	if (forceBuild || !zip) {
		const script = joinPath(workbenchRoot, "scripts", "build-and-pack.mjs");
		const result = await command.run("node", [script, project.dir], {
			cwd: project.dir,
			timeoutMs: 120_000,
		});
		if (result.exitCode !== 0) {
			throw new Error(result.stderr || result.stdout || `exit ${result.exitCode}`);
		}
		const manifest = await readJson(joinPath(project.dir, "plugin.json"));
		const version = typeof manifest?.version === "string" ? manifest.version : project.version;
		zip = joinPath(project.dir, "release", `${project.id}-${version}.zip`);
	}

	// 构建期间 dev-watch 可能已触发插件重载，必须用重载后的 fs session。
	const st = await withWorkbenchFs((fs) => fs.stat(zip));
	if (!st) throw new Error(`Zip not found: ${zip}`);

	await plugins.installFromPath(zip, {
		grantedPermissions: project.permissions,
		enable: true,
	});
	await plugins.setEnabled(project.id, true);
	if (project.permissions.length > 0) {
		await plugins.grantPermissions(project.id, project.permissions);
	}
	try {
		await plugins.reload(project.id);
	} catch {
		// first install may not need reload
	}

	if (refreshApp) {
		// Let install IPC settle, then hard-reload the renderer (full UI + plugin host cold start).
		window.setTimeout(() => {
			window.location.reload();
		}, 150);
		return { zipPath: zip };
	}

	if (startHotReload) {
		try {
			await plugins.startDevWatch(project.id, project.dir);
		} catch {
			// hot reload is best-effort after apply
		}
	}
	window.dispatchEvent(new Event("vetta:plugins-changed"));
	return { zipPath: zip };
}

/** Reinstall = force rebuild + re-apply + full app refresh. */
export async function reinstallPluginToVetta(
	project: ProjectInfo,
	workbenchRoot?: string,
): Promise<{ zipPath: string }> {
	return applyPluginToVetta({
		project,
		workbenchRoot,
		forceBuild: true,
		refreshApp: true,
		startHotReload: false,
	});
}
