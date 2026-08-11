import chalk from "chalk";
import { type Args, parseArgs, printHelp } from "../cli/args.js";
import { listModels } from "../cli/list-models.js";
import { APP_NAME, CONFIG_DIR_NAME, getAgentDir, VERSION } from "../config.js";
import { type CodingAgentHtmlExportRuntime, createCodingAgentHtmlExportRuntime } from "../export-html/index.js";
import { SettingsRuntime } from "../settings/index.js";
import { createAgentCliBootstrap } from "./coding-agent-cli-bootstrap.js";
import type { CodingAgentHostBootstrap } from "./coding-agent-host-bootstrap.js";
import { prepareCodingAgentPipedStdin } from "./coding-agent-print-invocation.js";
import { createCodingAgentResourcePackageRuntime } from "./coding-agent-resource-runtime.js";

type PackageCommand = "install" | "remove" | "update" | "list";

export interface CodingAgentCliControlOptions {
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
}

interface PackageCommandOptions {
	command: PackageCommand;
	source?: string;
	local: boolean;
	help: boolean;
	invalidOption?: string;
}

/** Run a CLI command that does not require a Session Runtime. */
export async function runCodingAgentCliControl(
	args: string[],
	options: CodingAgentCliControlOptions = {},
): Promise<boolean> {
	applyOfflineMode(args);
	if (await handlePackageCommand(args)) return true;
	if (!isBootstrapControl(parseArgs(args))) return false;
	return runCodingAgentCliControlWithBootstrap(await createAgentCliBootstrap(args), options);
}

/** Preserve the Legacy public entry while keeping control behavior outside Agent execution. */
export async function runCodingAgentCliControlWithBootstrap(
	bootstrap: CodingAgentHostBootstrap,
	options: CodingAgentCliControlOptions = {},
): Promise<boolean> {
	const { parsed, modelRegistry } = bootstrap;
	if (parsed.version) {
		console.log(VERSION);
		process.exit(0);
	}
	if (parsed.help) {
		printHelp();
		process.exit(0);
	}
	if (parsed.listModels !== undefined) {
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRegistry, searchPattern);
		process.exit(0);
	}
	if (!parsed.export) return false;

	if (parsed.mode !== "rpc") await prepareCodingAgentPipedStdin(parsed);
	try {
		const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
		const exporter = options.htmlExporter ?? createCodingAgentHtmlExportRuntime();
		const result = await exporter.exportLegacySession(parsed.export, outputPath);
		console.log(`Exported to: ${result}`);
		process.exit(0);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Failed to export session";
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}

function isBootstrapControl(parsed: Args): boolean {
	return (
		parsed.version === true || parsed.help === true || parsed.listModels !== undefined || parsed.export !== undefined
	);
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

function reportSettingsErrors(settingsManager: SettingsRuntime, context: string): void {
	const errors = settingsManager.drainErrors();
	for (const { scope, error } of errors) {
		console.error(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
		if (error.stack) console.error(chalk.dim(error.stack));
	}
}

function getPackageCommandUsage(command: PackageCommand): string {
	switch (command) {
		case "install":
			return `${APP_NAME} install <source> [-l]`;
		case "remove":
			return `${APP_NAME} remove <source> [-l]`;
		case "update":
			return `${APP_NAME} update [source]`;
		case "list":
			return `${APP_NAME} list`;
	}
}

function printPackageCommandHelp(command: PackageCommand): void {
	switch (command) {
		case "install":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("install")}

Install a package and add it to settings.

Options:
  -l, --local    Install project-locally (${CONFIG_DIR_NAME}/settings.json)

Examples:
  ${APP_NAME} install npm:@foo/bar
  ${APP_NAME} install git:github.com/user/repo
  ${APP_NAME} install git:git@github.com:user/repo
  ${APP_NAME} install https://github.com/user/repo
  ${APP_NAME} install ssh://git@github.com/user/repo
  ${APP_NAME} install ./local/path
`);
			return;
		case "remove":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("remove")}

Remove a package and its source from settings.

Options:
  -l, --local    Remove from project settings (${CONFIG_DIR_NAME}/settings.json)

Example:
  ${APP_NAME} remove npm:@foo/bar
`);
			return;
		case "update":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("update")}

Update installed packages.
If <source> is provided, only that package is updated.
`);
			return;
		case "list":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("list")}

List installed packages from user and project settings.
`);
			return;
	}
}

function parsePackageCommand(args: readonly string[]): PackageCommandOptions | undefined {
	const [command, ...rest] = args;
	if (command !== "install" && command !== "remove" && command !== "update" && command !== "list") {
		return undefined;
	}

	let local = false;
	let help = false;
	let invalidOption: string | undefined;
	let source: string | undefined;
	for (const arg of rest) {
		if (arg === "-h" || arg === "--help") {
			help = true;
			continue;
		}
		if (arg === "-l" || arg === "--local") {
			if (command === "install" || command === "remove") local = true;
			else invalidOption = invalidOption ?? arg;
			continue;
		}
		if (arg.startsWith("-")) {
			invalidOption = invalidOption ?? arg;
			continue;
		}
		if (!source) source = arg;
	}
	return { command, source, local, help, invalidOption };
}

async function handlePackageCommand(args: readonly string[]): Promise<boolean> {
	const options = parsePackageCommand(args);
	if (!options) return false;
	if (options.help) {
		printPackageCommandHelp(options.command);
		return true;
	}
	if (options.invalidOption) {
		console.error(chalk.red(`Unknown option ${options.invalidOption} for "${options.command}".`));
		console.error(chalk.dim(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`));
		process.exitCode = 1;
		return true;
	}

	const source = options.source;
	if ((options.command === "install" || options.command === "remove") && !source) {
		console.error(chalk.red(`Missing ${options.command} source.`));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsRuntime.create(cwd, agentDir);
	reportSettingsErrors(settingsManager, "package command");
	const packageRuntime = createCodingAgentResourcePackageRuntime({ cwd, agentDir, settings: settingsManager });
	packageRuntime.setProgressListener((event) => {
		if (event.type === "start") process.stdout.write(chalk.dim(`${event.message}\n`));
	});

	try {
		switch (options.command) {
			case "install":
				await packageRuntime.install(source!, { local: options.local });
				packageRuntime.addSource(source!, { local: options.local });
				console.log(chalk.green(`Installed ${source}`));
				return true;
			case "remove": {
				await packageRuntime.remove(source!, { local: options.local });
				const removed = packageRuntime.removeSource(source!, { local: options.local });
				if (!removed) {
					console.error(chalk.red(`No matching package found for ${source}`));
					process.exitCode = 1;
					return true;
				}
				console.log(chalk.green(`Removed ${source}`));
				return true;
			}
			case "list": {
				const globalPackages = settingsManager.getGlobalSettings().packages ?? [];
				const projectPackages = settingsManager.getProjectSettings().packages ?? [];
				if (globalPackages.length === 0 && projectPackages.length === 0) {
					console.log(chalk.dim("No packages installed."));
					return true;
				}
				const formatPackage = (pkg: (typeof globalPackages)[number], scope: "user" | "project") => {
					const packageSource = typeof pkg === "string" ? pkg : pkg.source;
					console.log(`  ${typeof pkg === "object" ? `${packageSource} (filtered)` : packageSource}`);
					const path = packageRuntime.getInstalledPath(packageSource, scope);
					if (path) console.log(chalk.dim(`    ${path}`));
				};
				if (globalPackages.length > 0) {
					console.log(chalk.bold("User packages:"));
					for (const pkg of globalPackages) formatPackage(pkg, "user");
				}
				if (projectPackages.length > 0) {
					if (globalPackages.length > 0) console.log();
					console.log(chalk.bold("Project packages:"));
					for (const pkg of projectPackages) formatPackage(pkg, "project");
				}
				return true;
			}
			case "update":
				await packageRuntime.update(source);
				console.log(chalk.green(source ? `Updated ${source}` : "Updated packages"));
				return true;
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown package command error";
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = 1;
		return true;
	}
}
