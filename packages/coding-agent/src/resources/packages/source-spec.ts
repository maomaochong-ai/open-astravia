import { type GitSource, parseGitUrl } from "./git-source.js";

export interface NpmResourceSource {
	type: "npm";
	spec: string;
	name: string;
	pinned: boolean;
}

export interface LocalResourceSource {
	type: "local";
	path: string;
}

export type ParsedResourceSource = NpmResourceSource | GitSource | LocalResourceSource;

export function parseNpmResourceSpec(spec: string): { name: string; version?: string } {
	const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
	if (!match) return { name: spec };
	return { name: match[1] ?? spec, version: match[2] };
}

export function parseResourceSource(source: string): ParsedResourceSource {
	if (source.startsWith("npm:")) {
		const spec = source.slice("npm:".length).trim();
		const { name, version } = parseNpmResourceSpec(spec);
		return { type: "npm", spec, name, pinned: Boolean(version) };
	}

	const trimmed = source.trim();
	const isWindowsAbsolutePath = /^[A-Za-z]:[\\/]|^\\\\/.test(trimmed);
	const isLocalPathLike =
		trimmed.startsWith(".") ||
		trimmed.startsWith("/") ||
		trimmed === "~" ||
		trimmed.startsWith("~/") ||
		isWindowsAbsolutePath;
	if (isLocalPathLike) return { type: "local", path: source };

	return parseGitUrl(source) ?? { type: "local", path: source };
}
