import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStandaloneEntry } from "./compile-standalone-entry.mjs";

const cliAppRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(cliAppRoot, "../..");
const codingAgentPackagePath = join(repositoryRoot, "packages", "coding-agent", "package.json");

const options = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(codingAgentPackagePath, "utf8"));
if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
	throw new Error(`Invalid coding-agent package metadata: ${codingAgentPackagePath}`);
}

const compiledPackageMetadata = {
	name: packageJson.name,
	version: packageJson.version,
	piConfig:
		typeof packageJson.piConfig?.name === "string"
			? {
					name: packageJson.piConfig.name,
				}
			: undefined,
};
const temporaryRoot = await mkdtemp(join(cliAppRoot, ".standalone-entry-"));
try {
	const entryPath = join(temporaryRoot, "standalone-entry.mjs");
	await writeFile(entryPath, createStandaloneEntry(options.entry), "utf8");
	const buildArgs = [
		"build",
		entryPath,
		"--compile",
		"--define",
		`VETTA_COMPILED_PACKAGE_METADATA=${JSON.stringify(compiledPackageMetadata)}`,
		"--outfile",
		options.outfile,
	];
	if (options.target) buildArgs.push("--target", options.target);
	if (options.metafile) buildArgs.push(`--metafile=${options.metafile}`);
	await run(process.platform === "win32" ? "bun.exe" : "bun", buildArgs);
} finally {
	await rm(temporaryRoot, { force: true, recursive: true });
}


function parseArgs(args) {
	let outfile;
	let target;
	let metafile;
	let entry = "cli";
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--outfile") {
			outfile = readValue(args, ++index, arg);
			continue;
		}
		if (arg === "--target") {
			target = readValue(args, ++index, arg);
			continue;
		}
		if (arg === "--metafile") {
			metafile = readValue(args, ++index, arg);
			continue;
		}
		if (arg === "--entry") {
			entry = readValue(args, ++index, arg);
			if (entry !== "cli" && entry !== "agent") {
				throw new Error(`Unsupported standalone entry: ${entry}`);
			}
			continue;
		}
		throw new Error(`Unknown compile-standalone option: ${arg}`);
	}
	if (!outfile) throw new Error("compile-standalone requires --outfile <path>");
	return { entry, metafile, outfile: resolve(outfile), target };
}

function readValue(args, index, option) {
	const value = args[index];
	if (!value) throw new Error(`${option} requires a value`);
	return value;
}

async function run(command, args) {
	await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, {
			cwd: repositoryRoot,
			stdio: "inherit",
			windowsHide: true,
		});
		child.once("error", rejectPromise);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			rejectPromise(new Error(`Standalone CLI compile failed (code=${code ?? "null"}, signal=${signal ?? "null"})`));
		});
	});
}
