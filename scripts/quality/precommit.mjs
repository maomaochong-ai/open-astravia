/**
 * Fast pre-commit gate:
 * 1) staged private-key + conflict-marker guards
 * 2) Biome on staged files only (--write)
 * 3) re-stage files that Biome rewrote
 *
 * Full typecheck stays in `bun run check` (PR / local full gate).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { git, ok, repoRoot, runBun, stagedFiles } from "./lib.mjs";

function runGuard(script, extraArgs = []) {
	const code = runBun(["run", script, ...extraArgs]);
	if (code !== 0) process.exit(code);
}

const before = stagedFiles();
if (before.length === 0) {
	ok("[precommit] no staged files; skip");
	process.exit(0);
}

console.log(`[precommit] ${before.length} staged file(s)`);

runGuard("scripts/quality/check-private-keys.mjs", ["--staged"]);
runGuard("scripts/quality/check-conflict-markers.mjs", ["--staged"]);
// Cheap (staged SKILL.md only) and worth catching here: a broken frontmatter
// makes the skill silently disappear at runtime, with nothing reported.
runGuard("scripts/quality/check-skill-frontmatter.mjs", ["--staged"]);

console.log("[precommit] biome --staged --write ...");
const biomeCode = runBun([
	"x",
	"@biomejs/biome",
	"check",
	"--write",
	"--error-on-warnings",
	"--staged",
	"--no-errors-on-unmatched",
]);
if (biomeCode !== 0) {
	console.error("[precommit] biome failed");
	process.exit(biomeCode);
}

// Re-stage previously staged paths that still exist (formatter may have rewritten them).
for (const file of before) {
	const full = join(repoRoot, file);
	if (existsSync(full)) {
		try {
			git(["add", "--", file], { allowFail: true });
		} catch {
			// ignore
		}
	}
}

ok("[precommit] passed (staged biome + guards). Before PR run: bun run check && bun run test:unit");
