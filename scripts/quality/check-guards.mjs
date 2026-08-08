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
	["scripts/quality/check-coding-agent-architecture.mjs"],
	["scripts/quality/check-runtime-coding-agent-independence.mjs"],
	["scripts/quality/check-runtime-subagents-boundary.mjs"],
	["scripts/quality/check-runtime-failure-contract.mjs"],
	["scripts/quality/check-agent-ai-maintainability.mjs"],
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
