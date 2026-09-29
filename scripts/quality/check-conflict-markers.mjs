/**
 * Fail on unresolved git conflict markers in sources.
 *
 * Usage:
 *   bun run scripts/quality/check-conflict-markers.mjs
 *   bun run scripts/quality/check-conflict-markers.mjs --staged
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, isBinaryLike, isDirectRun, ok, readText, rel, repoRoot, stagedFiles, walkFiles } from "./lib.mjs";

const MARKER_RE = /^(<<<<<<< |>>>>>>> |=======$)/m;

export function collectTargets({ stagedOnly = false, files = [] } = {}) {
	if (stagedOnly) {
		return stagedFiles()
			.map((f) => join(repoRoot, f))
			.filter((f) => existsSync(f) && !isBinaryLike(f));
	}
	if (files.length > 0) {
		return files.map((file) => join(repoRoot, file)).filter((file) => existsSync(file) && !isBinaryLike(file));
	}
	const roots = ["packages", "apps", "scripts"].map((d) => join(repoRoot, d));
	const targets = [];
	for (const root of roots) {
		targets.push(...walkFiles(root));
	}
	return targets.filter((f) => {
		const p = rel(f);
		return (
			!p.includes("/node_modules/") && !p.includes("/dist/") && !p.includes("/.next/") && !p.includes("/coverage/")
		);
	});
}

export function main(args = process.argv.slice(2)) {
	const stagedOnly = args.includes("--staged");
	const files = args.filter((arg) => arg !== "--staged");
	const targets = collectTargets({ stagedOnly, files });
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
		const scope = stagedOnly ? ", staged" : files.length > 0 ? ", selected" : "";
		ok(`[conflict-markers] ok (${targets.length} file(s)${scope})`);
		return 0;
	}
	fail(`[conflict-markers] ${hits} file(s) failed`);
	return 1;
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
