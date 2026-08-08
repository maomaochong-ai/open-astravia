import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repositoryRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const compileScript = join(repositoryRoot, "packages", "cli-app", "scripts", "compile-standalone.mjs");
const packageDir = join(repositoryRoot, "packages", "coding-agent");
const imGatewayDir = join(repositoryRoot, "packages", "im-gateway");
const compileTargets = {
	"darwin-arm64": "bun-darwin-arm64",
	"darwin-x64": "bun-darwin-x64",
	"linux-arm64": "bun-linux-arm64",
	"linux-x64": "bun-linux-x64",
	"win32-x64": "bun-windows-x64",
};

const suites = [
	{
		name: "coding-agent functional suite",
		command: process.execPath,
		args: ["run", "test", "--silent"],
		cwd: join(repositoryRoot, "packages", "coding-agent"),
	},
	{
		name: "CLI host functional suite",
		command: process.execPath,
		args: ["run", "test", "--silent"],
		cwd: join(repositoryRoot, "packages", "cli-app"),
	},
	{
		name: "Desktop host functional suite",
		command: process.execPath,
		args: ["run", "test", "--silent"],
		cwd: join(repositoryRoot, "packages", "desktop-app"),
	},
];

const platformTag = `${process.platform}-${process.arch}`;
const compileTarget = compileTargets[platformTag];
if (!compileTarget) throw new Error(`Unsupported host acceptance platform: ${platformTag}`);

const artifactRoot = await mkdtemp(join(tmpdir(), "vetta-agent-host-acceptance-"));
const binaryPath = join(artifactRoot, process.platform === "win32" ? "vetta.exe" : "vetta");
try {
	await run(
		"standalone Vetta CLI compilation",
		process.execPath,
		[compileScript, "--target", compileTarget, "--outfile", binaryPath],
		repositoryRoot,
	);
	await run("IM Gateway and real Agent suite", "go", ["test", "./...", "-count=1"], imGatewayDir, {
		VETTA_TEST_AGENT_BIN: binaryPath,
		VETTA_TEST_PACKAGE_DIR: packageDir,
	});
} finally {
	await rm(artifactRoot, { force: true, recursive: true });
}

for (const suite of suites) {
	await run(suite.name, suite.command, suite.args, suite.cwd);
}

console.log("[coding-agent-hosts] ok (coding-agent, CLI, Desktop, IM)");

async function run(name, command, args, cwd, extraEnv = {}) {
	console.log(`[coding-agent-hosts] ${name}`);
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, ...extraEnv },
			stdio: "inherit",
			windowsHide: true,
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${name} failed (code=${code ?? "null"}, signal=${signal ?? "null"})`));
		});
	});
}
