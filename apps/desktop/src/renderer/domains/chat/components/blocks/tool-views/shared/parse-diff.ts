export type DiffLineKind = "added" | "removed" | "context" | "meta";

export interface DiffLine {
	text: string;
	kind: DiffLineKind;
}

export interface DiffStats {
	added: number;
	removed: number;
}

export function classifyDiffLine(line: string): DiffLineKind {
	if (line.startsWith("+") && !line.startsWith("+++")) return "added";
	if (line.startsWith("-") && !line.startsWith("---")) return "removed";
	if (line.trim() === "...") return "meta";
	return "context";
}

export function parseDiff(diff: string): { lines: DiffLine[]; stats: DiffStats } {
	const lines = diff.split("\n").map((line) => ({ text: line, kind: classifyDiffLine(line) }));
	const stats = lines.reduce<DiffStats>(
		(acc, line) => {
			if (line.kind === "added") acc.added += 1;
			if (line.kind === "removed") acc.removed += 1;
			return acc;
		},
		{ added: 0, removed: 0 },
	);
	return { lines, stats };
}
