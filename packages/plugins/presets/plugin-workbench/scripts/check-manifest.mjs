#!/usr/bin/env node
/**
 * Validate plugin.json through @vetta-org/plugin-sdk, then report optional
 * authoring recommendations used by the plugin workbench.
 * Usage: node check-manifest.mjs <pluginRoot>
 */
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const manifestPath = join(root, "plugin.json");

function run(cmd, args, cwd) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});
		child.on("error", rejectPromise);
		child.on("close", (code) => {
			if (code === 0) resolvePromise({ stdout, stderr });
			else rejectPromise(new Error(stderr || stdout || `Command failed with exit ${code}`));
		});
	});
}

async function main() {
	let raw;
	try {
		raw = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		console.error(JSON.stringify({ ok: false, errors: [`Cannot read plugin.json: ${error}`] }, null, 2));
		process.exit(1);
	}

	let validated;
	try {
		const pluginCliPath = join(root, "node_modules", "@vetta-org", "plugin-vite", "dist", "cli.js");
		const result = await run(
			process.execPath,
			[pluginCliPath, "validate", "--root", root],
			root,
		);
		validated = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
	} catch (error) {
		console.error(
			JSON.stringify(
				{
					ok: false,
					errors: [error instanceof Error ? error.message : String(error)],
					hint: "Run npm install in the plugin project before validation.",
				},
				null,
				2,
			),
		);
		process.exit(1);
	}

	const warnings = [];
	if (!/^[a-z][a-z0-9-]{0,62}$/.test(validated.id)) {
		warnings.push("id is valid for the host, but lowercase kebab-case is recommended for publishing");
	}
	if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(validated.version)) {
		warnings.push("version is valid for the host, but semantic versioning is recommended for publishing");
	}
	if (validated.runtime !== "module-federation") {
		warnings.push("runtime should be module-federation for new plugins");
	}
	if (validated.runtime === "module-federation" && raw.entry !== "dist/mf-manifest.json") {
		warnings.push('entry is usually "dist/mf-manifest.json"');
	}
	if (!Array.isArray(raw.permissions)) warnings.push("permissions should be an array");

	if (raw.agent_mode !== undefined) {
		const modes = Array.isArray(raw.agent_mode) ? raw.agent_mode : [raw.agent_mode];
		const invalid = modes.filter((mode) => mode !== "work" && mode !== "coding");
		if (invalid.length > 0) {
			warnings.push(`agent_mode has unknown values: ${invalid.join(", ")} (known: work, coding)`);
		}
	}

	try {
		await access(join(root, raw.entry));
	} catch {
		warnings.push(`build entry missing (run build): ${raw.entry}`);
	}

	console.log(
		JSON.stringify(
			{ ok: true, id: validated.id, version: validated.version, errors: [], warnings },
			null,
			2,
		),
	);
}

void main();
