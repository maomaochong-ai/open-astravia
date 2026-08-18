import { type CodingAgentBootstrap, prepareCodingAgentPipedStdin } from "@vetta/coding-agent/bootstrap";
import { VERSION } from "@vetta/coding-agent/config";
import type { CodingAgentHtmlExportRuntime } from "@vetta/coding-agent/export-html";
import chalk from "chalk";
import { printAgentHelp } from "./agent-help.js";
import { createCliCodingAgentHtmlExportRuntime } from "./html-export-runtime.js";
import { listModels } from "./model-list-output.js";
import { type CodingAgentPackageCommandRuntime, runPackageCommand } from "./package-command.js";
import { readPipedStdin } from "./piped-stdin.js";

export interface CodingAgentCliControlOptions {
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
	readonly createBootstrap?: (args: string[]) => Promise<CodingAgentBootstrap>;
	readonly createPackageCommandRuntime?: () => CodingAgentPackageCommandRuntime;
}

/** Route process-level CLI commands that do not create an Agent Session. */
export async function runCodingAgentCliControl(
	args: string[],
	options: CodingAgentCliControlOptions = {},
): Promise<boolean> {
	applyOfflineMode(args);
	if (await runPackageCommand(args, options.createPackageCommandRuntime)) return true;
	if (args.includes("--version") || args.includes("-v")) {
		console.log(VERSION);
		process.exit(0);
	}
	if (args.includes("--help") || args.includes("-h")) {
		printAgentHelp();
		process.exit(0);
	}
	if (!requiresBootstrap(args)) return false;
	if (!options.createBootstrap) {
		throw new Error("CLI control requires a host-provided Coding Agent bootstrap factory");
	}
	return runCodingAgentCliControlWithBootstrap(await options.createBootstrap(args), options);
}

async function runCodingAgentCliControlWithBootstrap(
	bootstrap: CodingAgentBootstrap,
	options: CodingAgentCliControlOptions,
): Promise<boolean> {
	const { parsed, modelRegistry } = bootstrap;
	if (parsed.listModels !== undefined) {
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRegistry, searchPattern);
		process.exit(0);
	}
	if (!parsed.export) return false;

	if (parsed.mode !== "rpc") await prepareCodingAgentPipedStdin(parsed, readPipedStdin);
	try {
		const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
		const exporter = options.htmlExporter ?? createCliCodingAgentHtmlExportRuntime();
		const result = await exporter.exportLegacySession(parsed.export, outputPath);
		console.log(`Exported to: ${result}`);
		process.exit(0);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Failed to export session";
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

function requiresBootstrap(args: readonly string[]): boolean {
	return args.includes("--list-models") || args.includes("--export");
}

function applyOfflineMode(args: readonly string[]): void {
	if (!args.includes("--offline") && !isTruthyEnvFlag(process.env.PI_OFFLINE)) return;
	process.env.PI_OFFLINE = "1";
	process.env.PI_SKIP_VERSION_CHECK = "1";
}

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}
