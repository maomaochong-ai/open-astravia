export interface InstalledPluginSnapshotEntry {
	id: string;
	enabled: boolean;
}

export interface LoadedPluginSnapshotEntry {
	id: string;
}

export async function loadPluginSnapshot<
	TInstalled extends InstalledPluginSnapshotEntry,
	TLoaded extends LoadedPluginSnapshotEntry,
>(
	installedPlugins: readonly TInstalled[],
	previousPlugins: readonly TLoaded[],
	targetPluginIds: ReadonlySet<string> | undefined,
	loadPlugin: (plugin: TInstalled) => Promise<TLoaded>,
	onLoadError: (plugin: TInstalled, error: unknown) => void,
): Promise<TLoaded[]> {
	const previousById = new Map(previousPlugins.map((plugin) => [plugin.id, plugin]));
	const loadResults = await Promise.all(
		installedPlugins
			.filter((plugin) => plugin.enabled)
			.map(async (plugin) => {
				const previous = previousById.get(plugin.id);
				if (targetPluginIds && !targetPluginIds.has(plugin.id) && previous) return { plugin: previous };
				try {
					return { plugin: await loadPlugin(plugin) };
				} catch (error) {
					onLoadError(plugin, error);
					return previous ? { plugin: previous } : undefined;
				}
			}),
	);
	return loadResults.flatMap((result) => (result ? [result.plugin] : []));
}
