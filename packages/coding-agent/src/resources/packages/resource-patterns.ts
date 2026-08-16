import { minimatch } from "minimatch";
import type { ResourcePathPort } from "../contracts/resource-access.js";

export function isResourcePattern(value: string): boolean {
	return (
		value.startsWith("!") ||
		value.startsWith("+") ||
		value.startsWith("-") ||
		value.includes("*") ||
		value.includes("?")
	);
}

export function splitResourcePatterns(entries: string[]): { plain: string[]; patterns: string[] } {
	const plain: string[] = [];
	const patterns: string[] = [];
	for (const entry of entries) (isResourcePattern(entry) ? patterns : plain).push(entry);
	return { plain, patterns };
}

function matchesAnyPattern(paths: ResourcePathPort, filePath: string, patterns: string[], baseDir: string): boolean {
	const relativePath = toPatternPath(paths.relative(baseDir, filePath));
	const comparableFilePath = toPatternPath(filePath);
	const name = paths.basename(filePath);
	const isSkillFile = name === "SKILL.md";
	const parentDir = isSkillFile ? paths.dirname(filePath) : undefined;
	const parentRelative = parentDir ? toPatternPath(paths.relative(baseDir, parentDir)) : undefined;
	const comparableParentDir = parentDir ? toPatternPath(parentDir) : undefined;
	const parentName = parentDir ? paths.basename(parentDir) : undefined;
	return patterns.some((rawPattern) => {
		const pattern = toPatternPath(rawPattern);
		return (
			minimatch(relativePath, pattern) ||
			minimatch(name, pattern) ||
			minimatch(comparableFilePath, pattern) ||
			Boolean(
				isSkillFile &&
					(minimatch(parentRelative ?? "", pattern) ||
						minimatch(parentName ?? "", pattern) ||
						minimatch(comparableParentDir ?? "", pattern)),
			)
		);
	});
}

function matchesAnyExactPattern(
	paths: ResourcePathPort,
	filePath: string,
	patterns: string[],
	baseDir: string,
): boolean {
	const relativePath = toPatternPath(paths.relative(baseDir, filePath));
	const comparableFilePath = toPatternPath(filePath);
	const isSkillFile = paths.basename(filePath) === "SKILL.md";
	const parentDir = isSkillFile ? paths.dirname(filePath) : undefined;
	const parentRelative = parentDir ? toPatternPath(paths.relative(baseDir, parentDir)) : undefined;
	const comparableParentDir = parentDir ? toPatternPath(parentDir) : undefined;
	return patterns.some((pattern) => {
		const normalizedPattern = toPatternPath(pattern);
		const normalized = normalizedPattern.startsWith("./") ? normalizedPattern.slice(2) : normalizedPattern;
		return (
			normalized === relativePath ||
			normalized === comparableFilePath ||
			Boolean(isSkillFile && (normalized === parentRelative || normalized === comparableParentDir))
		);
	});
}

function toPatternPath(path: string): string {
	return path.replaceAll("\\", "/");
}

export function isResourceEnabledByOverrides(
	paths: ResourcePathPort,
	filePath: string,
	patterns: string[],
	baseDir: string,
): boolean {
	const overrides = patterns.filter(
		(pattern) => pattern.startsWith("!") || pattern.startsWith("+") || pattern.startsWith("-"),
	);
	const excludes = overrides.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
	const forceIncludes = overrides.filter((pattern) => pattern.startsWith("+")).map((pattern) => pattern.slice(1));
	const forceExcludes = overrides.filter((pattern) => pattern.startsWith("-")).map((pattern) => pattern.slice(1));
	let enabled = excludes.length === 0 || !matchesAnyPattern(paths, filePath, excludes, baseDir);
	if (forceIncludes.length > 0 && matchesAnyExactPattern(paths, filePath, forceIncludes, baseDir)) enabled = true;
	if (forceExcludes.length > 0 && matchesAnyExactPattern(paths, filePath, forceExcludes, baseDir)) enabled = false;
	return enabled;
}

export function applyResourcePatterns(
	paths: ResourcePathPort,
	allPaths: string[],
	patterns: string[],
	baseDir: string,
): Set<string> {
	const includes: string[] = [];
	const excludes: string[] = [];
	const forceIncludes: string[] = [];
	const forceExcludes: string[] = [];
	for (const pattern of patterns) {
		if (pattern.startsWith("+")) forceIncludes.push(pattern.slice(1));
		else if (pattern.startsWith("-")) forceExcludes.push(pattern.slice(1));
		else if (pattern.startsWith("!")) excludes.push(pattern.slice(1));
		else includes.push(pattern);
	}
	let result =
		includes.length === 0
			? [...allPaths]
			: allPaths.filter((path) => matchesAnyPattern(paths, path, includes, baseDir));
	if (excludes.length > 0) result = result.filter((path) => !matchesAnyPattern(paths, path, excludes, baseDir));
	for (const path of allPaths) {
		if (!result.includes(path) && matchesAnyExactPattern(paths, path, forceIncludes, baseDir)) result.push(path);
	}
	if (forceExcludes.length > 0) {
		result = result.filter((path) => !matchesAnyExactPattern(paths, path, forceExcludes, baseDir));
	}
	return new Set(result);
}
