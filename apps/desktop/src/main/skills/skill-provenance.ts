import { resolveSkillProviderPresentation, type SkillProviderPresentation } from "@vetta/capability-sdk";
import type { SkillPresentation } from "../../preload/api-types/skills.js";

export interface SkillPathContribution {
	readonly pluginId: string;
	readonly paths: readonly string[];
	readonly presentation?: SkillProviderPresentation;
}

export interface PluginSkillSource {
	readonly pluginId: string;
	readonly root: string;
	readonly icon?: string;
	readonly presentation?: SkillProviderPresentation;
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
				...(contribution.presentation ? { presentation: contribution.presentation } : {}),
			})),
		)
		.sort((left, right) => right.root.length - left.root.length);
}

export function resolvePluginSkillPresentation(
	source: PluginSkillSource,
	skillName: string,
	resolveText: (raw: string) => string | undefined,
): SkillPresentation | undefined {
	const provider = source.presentation;
	if (!provider) return undefined;
	const presentation = resolveSkillProviderPresentation(provider, skillName);
	if (!presentation) return undefined;
	const displayName = presentation.displayName ? resolveText(presentation.displayName) : undefined;
	const displayDescription = presentation.displayDescription
		? resolveText(presentation.displayDescription)
		: undefined;
	return {
		defaultVisibility: presentation.defaultVisibility,
		surfaces: presentation.surfaces,
		...(displayName ? { displayName } : {}),
		...(displayDescription ? { displayDescription } : {}),
	};
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
