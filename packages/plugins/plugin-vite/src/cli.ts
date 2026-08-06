#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parsePluginManifest } from "@vetta-org/plugin-sdk/manifest";
import { startVettaPluginDevServer } from "./dev-server.js";
import { createVettaPluginPackage } from "./pack.js";

type CliCommand = "dev" | "pack" | "validate";

interface CliOptions {
	command: CliCommand;
	rootDir: string;
}

function parseCliOptions(argv: string[]): CliOptions {
	const command = argv[0];
	if (command !== "dev" && command !== "pack" && command !== "validate") {
		throw new Error("Usage: vetta-plugin <dev|validate|pack> [--root <plugin-directory>]");
	}
	let rootDir = process.cwd();
	for (let index = 1; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument !== "--root" || !argv[index + 1]) {
			throw new Error(`Unknown or incomplete option: ${argument}`);
		}
		rootDir = resolve(argv[index + 1]);
		index += 1;
	}
	return { command, rootDir };
}

function writeEvent(event: object): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function runDevServer(rootDir: string): Promise<void> {
	const devServer = await startVettaPluginDevServer(rootDir, writeEvent);
	await new Promise<void>((resolvePromise) => {
		let closing = false;
		const close = () => {
			if (closing) return;
			closing = true;
			void devServer.close().finally(resolvePromise);
		};
		process.once("SIGINT", close);
		process.once("SIGTERM", close);
	});
}

async function validateManifest(rootDir: string): Promise<void> {
	const manifestPath = resolve(rootDir, "plugin.json");
	const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
	const manifest = parsePluginManifest(raw);
	process.stdout.write(
		`${JSON.stringify({
			ok: true,
			id: manifest.id,
			version: manifest.version,
			pluginApiVersion: manifest.pluginApiVersion,
			runtime: manifest.runtime,
		})}\n`,
	);
}

async function packPlugin(rootDir: string): Promise<void> {
	const raw: unknown = JSON.parse(await readFile(resolve(rootDir, "plugin.json"), "utf8"));
	const manifest = parsePluginManifest(raw);
	const result = await createVettaPluginPackage({ rootDir });
	process.stdout.write(
		`${JSON.stringify({
			ok: true,
			id: manifest.id,
			version: manifest.version,
			zipPath: result.outputPath,
			files: result.files.map((file) => file.archivePath),
		})}\n`,
	);
}

async function main(): Promise<void> {
	try {
		const options = parseCliOptions(process.argv.slice(2));
		if (options.command === "dev") {
			await runDevServer(options.rootDir);
			return;
		}
		if (options.command === "validate") {
			await validateManifest(options.rootDir);
			return;
		}
		await packPlugin(options.rootDir);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
		process.exitCode = 1;
	}
}

void main();
