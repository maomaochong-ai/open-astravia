#!/usr/bin/env node
/**
 * Install deps, bump patch, vite build, zip plugin for Vetta install.
 * Uses managed Node/npm (ADR-0011). Does not assume bun.
 *
 * Usage: node build-and-pack.mjs <pluginRoot> [--skip-install] [--no-bump]
 *
 * Output JSON: { ok, zipPath, id, version }
 */
import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
	const out = { root: null, skipInstall: false, noBump: false };
	out.root = argv[0] ? resolve(argv[0]) : null;
	for (const a of argv.slice(1)) {
		if (a === "--skip-install") out.skipInstall = true;
		else if (a === "--no-bump") out.noBump = true;
		else throw new Error(`Unknown arg: ${a}`);
	}
	return out;
}

function run(cmd, args, cwd) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("error", rejectPromise);
		child.on("close", (code) => {
			if (code === 0) resolvePromise({ stdout, stderr, code });
			else {
				const err = new Error(`${cmd} ${args.join(" ")} failed (exit ${code})\n${stderr || stdout}`);
				err.code = code;
				rejectPromise(err);
			}
		});
	});
}

function parsePackResult(stdout) {
	for (const line of stdout.trim().split(/\r?\n/).reverse()) {
		try {
			const parsed = JSON.parse(line);
			if (parsed?.ok === true && typeof parsed.zipPath === "string") return parsed;
		} catch {
			// npm may write non-JSON informational lines before the CLI result.
		}
	}
	throw new Error("vetta-plugin pack did not return a valid result");
}

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
	console.error("Usage: node build-and-pack.mjs <pluginRoot> [--skip-install] [--no-bump]");
	process.exit(2);
}

try {
	const manifestPath = join(args.root, "plugin.json");
	await access(manifestPath);

	if (!args.noBump) {
		await run(process.execPath, [join(__dirname, "bump-version.mjs"), args.root], args.root);
	}

	if (!args.skipInstall) {
		await run("npm", ["install"], args.root);
	}

	await run("npm", ["run", "build"], args.root);

	const pluginCliPath = join(args.root, "node_modules", "@vetta-org", "plugin-vite", "dist", "cli.js");
	const packRun = await run(
		process.execPath,
		[pluginCliPath, "pack", "--root", args.root],
		args.root,
	);
	const result = parsePackResult(packRun.stdout);
	const archive = await stat(result.zipPath);
	console.log(
		JSON.stringify(
			{
				ok: true,
				zipPath: result.zipPath,
				id: result.id,
				version: result.version,
				bytes: archive.size,
				fileCount: Array.isArray(result.files) ? result.files.length : undefined,
			},
			null,
			2,
		),
	);
} catch (err) {
	console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
	process.exit(1);
}
