/** Run Vitest with a supported Node.js runtime. */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");
const vitestEntry = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const minimumNodeMajor = 20;

function versionOf(command) {
	try {
		const output = execFileSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		const match = output.trim().match(/v?(\d+)(?:\.|$)/);
		return match ? Number(match[1]) : undefined;
	} catch {
		return undefined;
	}
}

function candidateNodeCommands() {
	if (process.env.VETTA_TEST_NODE) return [process.env.VETTA_TEST_NODE];
	const candidates = ["node"];
	if (process.platform === "win32") {
		if (process.env.ProgramFiles) candidates.push(join(process.env.ProgramFiles, "nodejs", "node.exe"));
		if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe"));
	} else {
		candidates.push("/usr/local/bin/node", "/usr/bin/node");
	}
	return candidates;
}

function findNode() {
	for (const candidate of candidateNodeCommands()) {
		if (candidate !== "node" && !existsSync(candidate)) continue;
		const major = versionOf(candidate);
		if (major !== undefined && major >= minimumNodeMajor) return candidate;
	}
	throw new Error(
		`Vitest requires Node.js ${minimumNodeMajor}+. Node was not found. ` +
			"Install Node.js or set VETTA_TEST_NODE to the absolute path of node executable.",
	);
}

if (!existsSync(vitestEntry)) {
	throw new Error(`Vitest entry was not found at ${vitestEntry}. Run bun install first.`);
}

const result = spawnSync(findNode(), [vitestEntry, ...process.argv.slice(2)], {
	cwd: process.cwd(),
	env: process.env,
	stdio: "inherit",
	shell: false,
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
