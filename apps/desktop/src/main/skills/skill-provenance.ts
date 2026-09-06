export interface SkillPathContribution {
	readonly pluginId: string;
	readonly paths: readonly string[];
}

export interface PluginSkillSource {
	readonly pluginId: string;
	readonly root: string;
	readonly icon?: string;
}

export function buildPluginSkillSources(
	contributions: readonly SkillPathContribution[],
	iconByPluginId: ReadonlyMap<string, string | undefined>,
): readonly PluginSkillSource[] {
	return contributions
		.flatMap((contribution) =>
			contribution.paths.map((path) => ({
				root: normalizeSkillPath(path),
				pluginId: contribution.pluginId,
				...(iconByPluginId.get(contribution.pluginId) ? { icon: iconByPluginId.get(contribution.pluginId) } : {}),
			})),
		)
		.sort((left, right) => right.root.length - left.root.length);
}

export function findPluginSkillSource(
	filePath: string,
	sources: readonly PluginSkillSource[],
): PluginSkillSource | undefined {
	const normalized = normalizeSkillPath(filePath);
	return sources.find((source) => normalized === source.root || normalized.startsWith(`${source.root}/`));
}

function normalizeSkillPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}
