import { readFileSync } from "node:fs";

export function extractReleaseNotes(changelog, version) {
	const lines = changelog.split(/\r?\n/);
	const heading = `## [${version}]`;
	const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
	if (start < 0) return undefined;

	const nextSection = lines.findIndex((line, index) => index > start && line.startsWith("## "));
	const notes = lines.slice(start + 1, nextSection < 0 ? undefined : nextSection).join("\n").trim();
	return notes || undefined;
}

export function resolveReleaseInfo(changelogPath, version) {
	const releaseNotes = extractReleaseNotes(readFileSync(changelogPath, "utf8"), version);
	if (!releaseNotes) {
		console.warn(`[prepare-pack] release notes for ${version} not found in ${changelogPath}`);
		return undefined;
	}
	return { releaseNotes };
}
