/**
 * Fail on unresolved git conflict markers in sources.
 *
 * Usage:
 *   bun run scripts/quality/check-conflict-markers.mjs
 *   bun run scripts/quality/check-conflict-markers.mjs --staged
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, isBinaryLike, ok, readText, rel, repoRoot, stagedFiles, walkFiles } from "./lib.mjs";

const MARKER_RE = /^(<<<<<<< |>>>>>>> |=======$)/m;

function collectTargets(stagedOnly) {
	if (stagedOnly) {
		return stagedFiles()
			.map((f) => join(repoRoot, f))
			.filter((f) => existsSync(f) && !isBinaryLike(f));
	}
	const roots = ["packages", "apps", "scripts"].map((d) => join(repoRoot, d));
	const files = [];
	for (const root of roots) {
		files.push(...walkFiles(root));
	}
	return files.filter((f) => {
		const p = rel(f);
		return (
			!p.includes("/node_modules/") && !p.includes("/dist/") && !p.includes("/.next/") && !p.includes("/coverage/")
		);
	});
}

const stagedOnly = process.argv.includes("--staged");
const targets = collectTargets(stagedOnly);
let hits = 0;

for (const file of targets) {
	let text;
	try {
		text = readText(file);
	} catch {
		continue;
	}
	if (MARKER_RE.test(text)) {
		hits += 1;
		fail(`[conflict-markers] ${rel(file)}`);
	}
}

if (hits === 0) {
	ok(`[conflict-markers] ok (${targets.length} file(s)${stagedOnly ? ", staged" : ""})`);
} else {
	fail(`[conflict-markers] ${hits} file(s) failed`);
	process.exit(1);
}
