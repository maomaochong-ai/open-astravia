/**
 * Run all always-on quality guards (used by `bun run check`).
 */

import { runBun } from "./lib.mjs";

const steps = [
	["packages/capability-sdk/scripts/generate-catalog.ts", "--check"],
	["scripts/quality/check-private-keys.mjs"],
	["scripts/quality/check-conflict-markers.mjs"],
	["scripts/quality/check-package-boundaries.mjs"],
	["scripts/quality/check-skill-frontmatter.mjs"],
];

let failed = 0;
for (const args of steps) {
	const code = runBun(["run", ...args]);
	if (code !== 0) failed = code;
}

process.exit(failed);
