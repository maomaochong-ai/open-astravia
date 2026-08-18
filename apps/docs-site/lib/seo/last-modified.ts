import { execFileSync } from "node:child_process";

export function getGitLastModified(filePath: string): string | undefined {
	if (!filePath) return undefined;

	try {
		const iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", filePath], {
			encoding: "utf8",
			windowsHide: true,
		}).trim();
		return iso || undefined;
	} catch {
		return undefined;
	}
}
