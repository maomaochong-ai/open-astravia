import { getFsApi } from "./runtime";

/** Read a file's text, treating "missing" as empty rather than an error. */
async function readTextOrEmpty(path: string): Promise<string> {
	try {
		const result = await getFsApi().readFile(path);
		return result.encoding === "utf8" ? result.content : "";
	} catch {
		return "";
	}
}

/**
 * Append repo-relative paths to the repository's root `.gitignore`, skipping
 * patterns it already lists verbatim.
 *
 * Deliberately literal: no globbing, no reordering, no rewriting of existing
 * lines. `.gitignore` is a file the user edits by hand and diffs in review, so
 * the only safe edit is adding the exact lines we were asked to add.
 */
export async function appendToGitignore(root: string, paths: readonly string[]): Promise<void> {
	const file = `${root}/.gitignore`;
	const existing = await readTextOrEmpty(file);
	const present = new Set(
		existing
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
	);
	const additions = [...new Set(paths.map((path) => `/${path}`))].filter((pattern) => !present.has(pattern));
	if (additions.length === 0) return;

	const needsNewline = existing.length > 0 && !existing.endsWith("\n");
	const next = `${existing}${needsNewline ? "\n" : ""}${additions.join("\n")}\n`;
	await getFsApi().writeFile(file, next);
}
