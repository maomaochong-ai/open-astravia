/**
 * Run all independent always-on quality guards in parallel (used by `bun run check`).
 */

import { spawn } from "node:child_process";
import { repoRoot } from "./lib.mjs";

const steps = [
	["packages/capability-sdk/scripts/generate-catalog.ts", "--check"],
	["scripts/quality/check-private-keys.mjs"],
	["scripts/quality/check-conflict-markers.mjs"],
	["scripts/quality/check-build-order.mjs"],
	["scripts/quality/check-package-boundaries.mjs"],
	["scripts/quality/check-legacy-execution-retirement.mjs"],
	["scripts/quality/check-coding-agent-rewrite-progress.mjs"],
	["scripts/quality/check-coding-agent-composition-contract.mjs"],
	["scripts/quality/check-coding-agent-runtime-port-ownership.mjs"],
	["scripts/quality/check-coding-agent-implementation-log.mjs"],
	["scripts/quality/check-standalone-cli-build.mjs"],
	["scripts/quality/check-skill-frontmatter.mjs"],
];

function runStep(args) {
	return new Promise((resolve) => {
		const child = spawn("bun", ["run", ...args], {
			cwd: repoRoot,
			stdio: "inherit",
			shell: false,
		});
		child.once("error", () => resolve(1));
		child.once("exit", (code) => resolve(code ?? 1));
	});
}

const results = await Promise.all(steps.map(runStep));
process.exit(results.find((code) => code !== 0) ?? 0);
