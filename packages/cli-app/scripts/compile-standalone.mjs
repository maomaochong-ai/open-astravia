import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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


function createStandaloneEntry(entry) {
	const runtimeImport =
		entry === "agent"
			? 'import { runAgentCli } from "../src/run-agent-cli.ts";'
			: 'import { runCli } from "../src/run-cli.ts";';
	const runtimeCall =
		entry === "agent"
			? "await runAgentCli(process.argv.slice(2), { htmlExporter });"
			: "await runCli(process.argv.slice(2), { htmlExporter });";
	return [
		runtimeImport,
		'import { createCodingAgentHtmlExportRuntime } from "../../coding-agent/src/public-api/export-html.ts";',
		'import { installBuiltinThemeDocuments } from "../../coding-agent/src/modes/interactive/theme/theme.ts";',
		'import { installPhotonModuleLoader, installPhotonWasmPath } from "../../coding-agent/src/utils/photon.ts";',
		'import template from "../../coding-agent/src/export-html/assets/template.html" with { type: "text" };',
		'import css from "../../coding-agent/src/export-html/assets/template.css" with { type: "text" };',
		'import js from "../../coding-agent/src/export-html/assets/template.js" with { type: "text" };',
		'import markedJs from "../../coding-agent/src/export-html/assets/vendor/marked.min.js" with { type: "text" };',
		'import highlightJs from "../../coding-agent/src/export-html/assets/vendor/highlight.min.js" with { type: "text" };',
		'import darkTheme from "../../coding-agent/src/modes/interactive/theme/dark.json";',
		'import lightTheme from "../../coding-agent/src/modes/interactive/theme/light.json";',
		'import photonWasmPath from "../../coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" };',
		"",
		"const htmlExporter = createCodingAgentHtmlExportRuntime({ assets: { template, css, js, markedJs, highlightJs } });",
		"installBuiltinThemeDocuments({ dark: darkTheme, light: lightTheme });",
		"installPhotonWasmPath(photonWasmPath);",
		'installPhotonModuleLoader(() => import("../../coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs.js"));',
		runtimeCall,
		"",
	].join("\n");
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
