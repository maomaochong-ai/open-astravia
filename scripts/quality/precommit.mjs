/**
 * Fast pre-commit gate:
 * 1) staged private-key + conflict-marker guards
 * 2) read-only Biome check on staged files
 *
 * Formatting stays explicit so a commit hook never stages previously unstaged
 * hunks from a partially staged file. Full typecheck stays in `bun run check`.
 */

import { ok, runBun, stagedFiles } from "./lib.mjs";

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

console.log("[precommit] biome --staged ...");
const biomeCode = runBun([
	"x",
	"@biomejs/biome",
	"check",
	"--error-on-warnings",
	"--staged",
	"--no-errors-on-unmatched",
]);
if (biomeCode !== 0) {
	console.error("[precommit] biome failed");
	process.exit(biomeCode);
}
ok("[precommit] passed (staged biome + guards). Before PR run: bun run check && bun run test:unit");
