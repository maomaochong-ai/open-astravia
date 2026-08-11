import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ActionRpcError, createActionRpcClient, readActionRpcEndpoint } from "@vetta/action-rpc";
import { resolveNpmPluginArchive, type ResolvedNpmPluginArchive } from "./npm-package.js";

export type PluginAddCommand =
	| { type: "help" }
	| { type: "error"; message: string }
	| { type: "add"; source: string; json: boolean };

export interface PluginAddCommandDependencies {
	resolveNpmArchive(packageSpec: string): Promise<ResolvedNpmPluginArchive>;
	runAction(actionId: string, input: unknown): Promise<unknown>;
	writeStdout(value: string): void;
	writeStderr(value: string): void;
}

const HELP_TEXT = `Vetta plugin installer

Usage:
  vetta-plugin-cli add <npm-package|zip-path|http-url> [--json]

Examples:
  npx @vetta-org/plugin-cli add @example/vetta-plugin-demo
  npx @vetta-org/plugin-cli add @example/vetta-plugin-demo@1.2.0
  npx @vetta-org/plugin-cli add ./release/demo-1.2.0.zip
`;

function formatParseError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function parsePluginAddCommand(argv: string[]): PluginAddCommand | undefined {
	if (argv[0] !== "add") return undefined;
	if (argv[1] === "-h" || argv[1] === "--help") return { type: "help" };
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({ args: argv.slice(1), allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
	} catch (error) {
		return { type: "error", message: formatParseError(error) };
	}
	const [source, unexpected] = parsed.positionals;
	if (!source) return { type: "error", message: "Missing <npm-package|zip-path|http-url>" };
	if (unexpected) return { type: "error", message: `Unexpected argument: ${unexpected}` };
	return { type: "add", source, json: parsed.values.json === true };
}

async function defaultRunAction(actionId: string, input: unknown): Promise<unknown> {
	const client = createActionRpcClient(await readActionRpcEndpoint());
	return client.run(actionId, input);
}

const defaultDependencies: PluginAddCommandDependencies = {
	resolveNpmArchive: resolveNpmPluginArchive,
	runAction: defaultRunAction,
	writeStdout: (value) => process.stdout.write(value),
	writeStderr: (value) => process.stderr.write(value),
};

function isHttpUrl(source: string): boolean {
	try {
		const url = new URL(source);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function isLocalZip(source: string): boolean {
	return source.toLowerCase().endsWith(".zip") || existsSync(resolve(source));
}

function npmInstallInput(resolved: ResolvedNpmPluginArchive): Record<string, unknown> {
	return {
		operation: "install-from-path",
		path: resolved.archivePath,
		enable: true,
		source: "npm",
		expectedSha256: resolved.expectedSha256,
		expectedId: resolved.packageManifest.vetta.pluginId,
		expectedVersion: resolved.packageManifest.version,
		npm: {
			packageName: resolved.packageManifest.name,
			requestedSpec: resolved.requestedSpec,
			resolvedVersion: resolved.packageManifest.version,
			...(resolved.integrity ? { integrity: resolved.integrity } : {}),
		},
	};
}

function resultSummary(result: unknown): string {
	if (typeof result !== "object" || result === null || Array.isArray(result)) return "Plugin installed.\n";
	const response = result as Record<string, unknown>;
	const plugin =
		typeof response.plugin === "object" && response.plugin !== null && !Array.isArray(response.plugin)
			? (response.plugin as Record<string, unknown>)
			: undefined;
	if (!plugin) return "Plugin installed.\n";
	const id = typeof plugin.id === "string" ? plugin.id : "plugin";
	const version = typeof plugin.version === "string" ? `@${plugin.version}` : "";
	const pending = typeof plugin.pendingVersion === "string" ? ` Update ${plugin.pendingVersion} is pending reload.` : "";
	return `Installed ${id}${version}.${pending}\n`;
}

function isConnectionError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = (error as NodeJS.ErrnoException).code;
	return (
		code === "ENOENT" ||
		code === "ECONNREFUSED" ||
		code === "ECONNRESET" ||
		error.message.includes("ECONNREFUSED") ||
		error.message.includes("fetch failed")
	);
}

export async function runPluginAddCommand(
	command: PluginAddCommand,
	dependencies: PluginAddCommandDependencies = defaultDependencies,
): Promise<number> {
	if (command.type === "help") {
		dependencies.writeStdout(HELP_TEXT);
		return 0;
	}
	if (command.type === "error") {
		dependencies.writeStderr(`${command.message}\n`);
		return 2;
	}

	let resolvedNpm: ResolvedNpmPluginArchive | undefined;
	try {
		let result: unknown;
		if (isHttpUrl(command.source)) {
			result = await dependencies.runAction("plugins.manage", {
				operation: "install-from-url",
				url: command.source,
			});
		} else if (isLocalZip(command.source)) {
			result = await dependencies.runAction("plugins.manage", {
				operation: "install-from-path",
				path: resolve(command.source),
				enable: true,
			});
		} else {
			resolvedNpm = await dependencies.resolveNpmArchive(command.source);
			result = await dependencies.runAction("plugins.manage", npmInstallInput(resolvedNpm));
		}
		dependencies.writeStdout(command.json ? `${JSON.stringify({ ok: true, result })}\n` : resultSummary(result));
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (command.json) {
			dependencies.writeStdout(
				`${JSON.stringify({ ok: false, error: { code: error instanceof ActionRpcError ? error.code : "PLUGIN_ADD_FAILED", message } })}\n`,
			);
		} else {
			dependencies.writeStderr(`${message}\n`);
		}
		if (error instanceof ActionRpcError) return 4;
		return isConnectionError(error) ? 3 : 5;
	} finally {
		await resolvedNpm?.cleanup();
	}
}

export async function runPluginCli(argv: string[]): Promise<number> {
	if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
		return runPluginAddCommand({ type: "help" });
	}
	const command = parsePluginAddCommand(argv);
	if (!command) {
		process.stderr.write(`Unknown command: ${argv[0]}\n`);
		return 2;
	}
	return runPluginAddCommand(command);
}
