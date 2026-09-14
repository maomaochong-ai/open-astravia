import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ActionRpcError, createActionRpcClient, readActionRpcEndpoint } from "@vetta/action-rpc";
import { resolveNpmPluginArchive, type ResolvedNpmPluginArchive } from "./npm-package.js";
import { initPluginProject } from "./init.js";
import { findPluginHub, findPluginProject, readManualSdkVersion, resolveManualDir } from "./workspace.js";

export type PluginAddCommand =
	| { type: "help" }
	| { type: "error"; message: string }
	| { type: "add"; source: string; json: boolean };

export type PluginReloadCommand =
	| { type: "help" }
	| { type: "error"; message: string }
	| { type: "reload"; pluginId: string; json: boolean };

export type PluginDocsCommand =
	| { type: "help" }
	| { type: "error"; message: string }
	| { type: "docs"; json: boolean };

export type PluginInitCommand =
	| { type: "help" }
	| { type: "error"; message: string }
	| { type: "init"; targetDir?: string; pluginId: string; displayName?: string; json: boolean; registerInHub: boolean };

export type PluginWatchCommand =
	| { type: "help" }
	| { type: "error"; message: string }
	| { type: "watch"; dir?: string; stop: boolean; json: boolean };

export type PluginCommand =
	| PluginAddCommand
	| PluginReloadCommand
	| PluginDocsCommand
	| PluginInitCommand
	| PluginWatchCommand;

export interface PluginCommandDependencies {
	resolveNpmArchive(packageSpec: string): Promise<ResolvedNpmPluginArchive>;
	/** 命令执行时所在目录；缺省用 process.cwd()，测试与非交互调用方可以覆盖。 */
	cwd?(): string;
	runAction(actionId: string, input: unknown): Promise<unknown>;
	writeStdout(value: string): void;
	writeStderr(value: string): void;
}

export type PluginAddCommandDependencies = PluginCommandDependencies;

const HELP_TEXT = `Vetta plugin manager

Usage:
  vetta-plugin-cli add <npm-package|zip-path|http-url> [--json]
  vetta-plugin-cli reload <plugin-id> [--json]
  vetta-plugin-cli docs [--json]
  vetta-plugin-cli init --id <plugin-id> [--name <display>] [dir] [--no-hub] [--json]
  vetta-plugin-cli watch [dir] [--stop] [--json]

Examples:
  npx @vetta-org/plugin-cli add @example/vetta-plugin-demo
  npx @vetta-org/plugin-cli add @example/vetta-plugin-demo@1.2.0
  npx @vetta-org/plugin-cli add .                      # 当前插件工程（先 pack）
  npx @vetta-org/plugin-cli add ./release/demo-1.2.0.zip
  npx @vetta-org/plugin-cli reload demo
  npx @vetta-org/plugin-cli docs
  npx @vetta-org/plugin-cli init --id my-plugin --name "My Plugin"
  npx @vetta-org/plugin-cli watch          # 让宿主改从工程目录加载，改完即生效
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

export function parsePluginReloadCommand(argv: string[]): PluginReloadCommand | undefined {
	if (argv[0] !== "reload") return undefined;
	if (argv[1] === "-h" || argv[1] === "--help") return { type: "help" };
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({ args: argv.slice(1), allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
	} catch (error) {
		return { type: "error", message: formatParseError(error) };
	}
	const [pluginId, unexpected] = parsed.positionals;
	if (!pluginId) return { type: "error", message: "Missing <plugin-id>" };
	if (unexpected) return { type: "error", message: `Unexpected argument: ${unexpected}` };
	return { type: "reload", pluginId, json: parsed.values.json === true };
}

export function parsePluginDocsCommand(argv: string[]): PluginDocsCommand | undefined {
	if (argv[0] !== "docs") return undefined;
	if (argv[1] === "-h" || argv[1] === "--help") return { type: "help" };
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({ args: argv.slice(1), allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
	} catch (error) {
		return { type: "error", message: formatParseError(error) };
	}
	const [unexpected] = parsed.positionals;
	if (unexpected) return { type: "error", message: `Unexpected argument: ${unexpected}` };
	return { type: "docs", json: parsed.values.json === true };
}

export function parsePluginInitCommand(argv: string[]): PluginInitCommand | undefined {
	if (argv[0] !== "init") return undefined;
	if (argv[1] === "-h" || argv[1] === "--help") return { type: "help" };
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args: argv.slice(1),
			allowPositionals: true,
			strict: true,
			options: {
				id: { type: "string" },
				name: { type: "string" },
				json: { type: "boolean" },
				"no-hub": { type: "boolean" },
			},
		});
	} catch (error) {
		return { type: "error", message: formatParseError(error) };
	}
	const pluginId = parsed.values.id;
	if (typeof pluginId !== "string" || pluginId.length === 0) {
		return { type: "error", message: "Missing --id <plugin-id>" };
	}
	const [targetDir, unexpected] = parsed.positionals;
	if (unexpected) return { type: "error", message: `Unexpected argument: ${unexpected}` };
	return {
		type: "init",
		...(targetDir ? { targetDir } : {}),
		pluginId,
		...(typeof parsed.values.name === "string" ? { displayName: parsed.values.name } : {}),
		json: parsed.values.json === true,
		registerInHub: parsed.values["no-hub"] !== true,
	};
}

export function parsePluginWatchCommand(argv: string[]): PluginWatchCommand | undefined {
	if (argv[0] !== "watch") return undefined;
	if (argv[1] === "-h" || argv[1] === "--help") return { type: "help" };
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args: argv.slice(1),
			allowPositionals: true,
			strict: true,
			options: { json: { type: "boolean" }, stop: { type: "boolean" } },
		});
	} catch (error) {
		return { type: "error", message: formatParseError(error) };
	}
	const [dir, unexpected] = parsed.positionals;
	if (unexpected) return { type: "error", message: `Unexpected argument: ${unexpected}` };
	return {
		type: "watch",
		...(dir ? { dir } : {}),
		stop: parsed.values.stop === true,
		json: parsed.values.json === true,
	};
}

async function defaultRunAction(actionId: string, input: unknown): Promise<unknown> {
	const client = createActionRpcClient(await readActionRpcEndpoint());
	return client.run(actionId, input);
}

const defaultDependencies: PluginCommandDependencies = {
	resolveNpmArchive: resolveNpmPluginArchive,
	cwd: () => process.cwd(),
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
	if (source.toLowerCase().endsWith(".zip")) return true;
	const path = resolve(source);
	// 目录不是压缩包：它是一个插件工程，走 resolveProjectArchive 先找它打出来的产物。
	return existsSync(path) && !statSync(path).isDirectory();
}

function isDirectorySource(source: string): boolean {
	const path = resolve(source);
	return existsSync(path) && statSync(path).isDirectory();
}

/**
 * 把「装当前这个工程」翻译成一个具体的归档路径。
 *
 * 这条路径是给 `install:vetta` 这类脚本用的：作者（或 Agent）在插件目录里跑一条命令就
 * 装进 Vetta，不必记住产物叫什么名字。找不到产物时给出该跑的那条命令，而不是报一个
 * 「文件不存在」让人自己猜。
 */
function resolveProjectArchive(source: string): { archivePath: string; pluginId: string } {
	const from = resolve(source);
	const project = findPluginProject(from);
	if (!project) {
		const hub = findPluginHub(from);
		if (hub) {
			throw new Error(
				`${from} indexes plugins but is not one itself. Run this from a plugin directory, or pass its path: vetta-plugin-cli add ./path/to/plugin`,
			);
		}
		throw new Error(`No plugin.json found in ${from} or any parent directory.`);
	}
	const archivePath = join(project.root, "release", `${project.pluginId}-${project.version}.zip`);
	if (!existsSync(archivePath)) {
		throw new Error(
			`Packaged archive not found: ${archivePath}\nBuild it first: npm run build && npx vetta-plugin pack`,
		);
	}
	return { archivePath, pluginId: project.pluginId };
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
	const pending = typeof plugin.pendingVersion === "string"
		? ` Update ${plugin.pendingVersion} is pending reload. Run \`vetta-plugin-cli reload ${id}\` to apply it.`
		: "";
	return `Installed ${id}${version}.${pending}\n`;
}

function reloadResultSummary(result: unknown, requestedPluginId: string): string {
	if (typeof result !== "object" || result === null || Array.isArray(result)) {
		return `Reloaded ${requestedPluginId}.\n`;
	}
	const response = result as Record<string, unknown>;
	const plugin =
		typeof response.plugin === "object" && response.plugin !== null && !Array.isArray(response.plugin)
			? (response.plugin as Record<string, unknown>)
			: undefined;
	const id = typeof plugin?.id === "string" ? plugin.id : requestedPluginId;
	const version = typeof plugin?.activeVersion === "string" ? `@${plugin.activeVersion}` : "";
	return `Reloaded ${id}${version}.\n`;
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
	return runPluginCommand(command, dependencies);
}

export async function runPluginCommand(
	command: PluginCommand,
	dependencies: PluginCommandDependencies = defaultDependencies,
): Promise<number> {
	if (command.type === "help") {
		dependencies.writeStdout(HELP_TEXT);
		return 0;
	}
	if (command.type === "error") {
		dependencies.writeStderr(`${command.message}\n`);
		return 2;
	}

	if (command.type === "docs") {
		return runDocsCommand(command, dependencies);
	}
	if (command.type === "init") {
		return runInitCommand(command, dependencies);
	}

	if (command.type === "watch") {
		return runWatchCommand(command, dependencies);
	}

	let resolvedNpm: ResolvedNpmPluginArchive | undefined;
	try {
		let result: unknown;
		if (command.type === "reload") {
			result = await dependencies.runAction("plugins.manage", {
				operation: "reload",
				id: command.pluginId,
			});
		} else if (isHttpUrl(command.source)) {
			result = await dependencies.runAction("plugins.manage", {
				operation: "install-from-url",
				url: command.source,
			});
		} else if (isDirectorySource(command.source)) {
			const { archivePath } = resolveProjectArchive(command.source);
			result = await dependencies.runAction("plugins.manage", {
				operation: "install-from-path",
				path: archivePath,
				enable: true,
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
		dependencies.writeStdout(
			command.json
				? `${JSON.stringify({ ok: true, result })}\n`
				: command.type === "reload"
					? reloadResultSummary(result, command.pluginId)
					: resultSummary(result),
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (command.json) {
			dependencies.writeStdout(
				`${JSON.stringify({ ok: false, error: { code: error instanceof ActionRpcError ? error.code : command.type === "reload" ? "PLUGIN_RELOAD_FAILED" : "PLUGIN_ADD_FAILED", message } })}\n`,
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

/**
 * 打印随 SDK 发布的手册目录。
 *
 * 存在的理由是「不要让任何人硬编码 node_modules 路径」：工作区会把依赖提升到仓库根，
 * 一仓多插件的 hub 里每个插件也可能各装一份。Agent 只需记住这一条命令，拿回来的永远是
 * 当前工程实际编译所针对的那个 SDK 版本的手册。
 */
function runDocsCommand(command: { json: boolean }, dependencies: PluginCommandDependencies): number {
	const cwd = dependencies.cwd?.() ?? process.cwd();
	const manualDir = resolveManualDir(cwd);
	if (!manualDir) {
		const message =
			"Plugin manual not found. Install the SDK first: npm i -D @vetta-org/plugin-sdk\n";
		if (command.json) {
			dependencies.writeStdout(
				`${JSON.stringify({ ok: false, error: { code: "MANUAL_NOT_FOUND", message: message.trim() } })}\n`,
			);
		} else {
			dependencies.writeStderr(message);
		}
		return 6;
	}
	const project = findPluginProject(cwd);
	const hub = findPluginHub(cwd);
	const sdkVersion = readManualSdkVersion(manualDir);
	if (command.json) {
		dependencies.writeStdout(
			`${JSON.stringify({
				ok: true,
				manualDir,
				entry: join(manualDir, "README.md"),
				sdkVersion,
				project: project ? { root: project.root, pluginId: project.pluginId, version: project.version } : undefined,
				hub: hub ? { root: hub.root, manifestPath: hub.manifestPath } : undefined,
			})}\n`,
		);
		return 0;
	}
	const lines = [
		`Plugin manual (@vetta-org/plugin-sdk${sdkVersion ? `@${sdkVersion}` : ""}):`,
		`  ${manualDir}`,
		`Start here: ${join(manualDir, "README.md")}`,
	];
	if (project) lines.push(`Current plugin: ${project.pluginId} (${project.root})`);
	if (hub) lines.push(`Marketplace hub: ${hub.manifestPath}`);
	dependencies.writeStdout(`${lines.join("\n")}\n`);
	return 0;
}

/** 在陌生目录里生成一个可直接开工的插件工程，并留下让任意 Agent 自举的 AGENTS.md。 */
function runInitCommand(
	command: Extract<PluginCommand, { type: "init" }>,
	dependencies: PluginCommandDependencies,
): number {
	const cwd = dependencies.cwd?.() ?? process.cwd();
	try {
		const result = initPluginProject({
			targetDir: resolve(cwd, command.targetDir ?? command.pluginId),
			pluginId: command.pluginId,
			displayName: command.displayName ?? command.pluginId,
			registerInHub: command.registerInHub,
		});
		dependencies.writeStdout(
			command.json
				? `${JSON.stringify({ ok: true, ...result })}\n`
				: [
						`Created ${result.pluginId} at ${result.root}`,
						result.hubManifestPath ? `Listed it in ${result.hubManifestPath}` : undefined,
						"Next: npm install && npm run install:vetta",
						"The agent brief is in AGENTS.md; the manual is at `npx vetta-plugin-cli docs`.",
					]
						.filter(Boolean)
						.join("\n")
						.concat("\n"),
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (command.json) {
			dependencies.writeStdout(`${JSON.stringify({ ok: false, error: { code: "PLUGIN_INIT_FAILED", message } })}\n`);
		} else {
			dependencies.writeStderr(`${message}\n`);
		}
		return 5;
	}
}

/**
 * 让宿主改从工程目录加载本插件，之后改源码即时生效，不必每次 build → pack → install。
 *
 * 目标插件按 cwd 向上找，理由同 `add .`：一仓多插件时「我正站在哪个插件里」是唯一不会
 * 弄错的意图，而 id 靠人重复输入迟早会错配到另一个插件上。
 */
async function runWatchCommand(
	command: Extract<PluginCommand, { type: "watch" }>,
	dependencies: PluginCommandDependencies,
): Promise<number> {
	const cwd = dependencies.cwd?.() ?? process.cwd();
	const from = resolve(cwd, command.dir ?? ".");
	try {
		const project = findPluginProject(from);
		if (!project) {
			const hub = findPluginHub(from);
			throw new Error(
				hub
					? `${from} indexes plugins but is not one itself. Run this from a plugin directory, or pass its path.`
					: `No plugin.json found in ${from} or any parent directory.`,
			);
		}
		const result = command.stop
			? await dependencies.runAction("plugins.manage", { operation: "dev-watch-stop", id: project.pluginId })
			: await dependencies.runAction("plugins.manage", {
					operation: "dev-watch",
					id: project.pluginId,
					projectDir: project.root,
				});
		dependencies.writeStdout(
			command.json
				? `${JSON.stringify({ ok: true, result })}\n`
				: command.stop
					? `Stopped hot reload for ${project.pluginId}.\n`
					: `Hot reload on for ${project.pluginId}. Vetta now loads it from ${project.root}.\n`,
		);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (command.json) {
			dependencies.writeStdout(
				`${JSON.stringify({ ok: false, error: { code: error instanceof ActionRpcError ? error.code : "PLUGIN_WATCH_FAILED", message } })}\n`,
			);
		} else {
			dependencies.writeStderr(`${message}\n`);
		}
		if (error instanceof ActionRpcError) return 4;
		return isConnectionError(error) ? 3 : 5;
	}
}

export async function runPluginCli(argv: string[]): Promise<number> {
	if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
		return runPluginAddCommand({ type: "help" });
	}
	const command = parsePluginAddCommand(argv) ?? parsePluginReloadCommand(argv) ?? parsePluginDocsCommand(argv) ?? parsePluginInitCommand(argv) ?? parsePluginWatchCommand(argv);
	if (!command) {
		process.stderr.write(`Unknown command: ${argv[0]}\n`);
		return 2;
	}
	return runPluginCommand(command);
}
