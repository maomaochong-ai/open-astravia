import { APP_NAME, CONFIG_DIR_NAME } from "@vetta/coding-agent/config";
import type { ResourcePackageRuntime } from "@vetta/coding-agent/resources";
import type { SettingsRuntime } from "@vetta/coding-agent/settings";
import chalk from "chalk";

type PackageCommand = "install" | "remove" | "update" | "list";

export interface CodingAgentPackageCommandRuntime {
	readonly settings: SettingsRuntime;
	readonly packages: ResourcePackageRuntime;
}

interface PackageCommandOptions {
	readonly command: PackageCommand;
	readonly source?: string;
	readonly local: boolean;
	readonly help: boolean;
	readonly invalidOption?: string;
}

/** Parse and execute CLI package-management commands using host-owned state and effects. */
export async function runPackageCommand(
	args: readonly string[],
	createRuntime?: () => CodingAgentPackageCommandRuntime,
): Promise<boolean> {
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

	if (!createRuntime) throw new Error("Package commands require a host-provided Resource Package runtime factory");
	const { settings, packages } = createRuntime();
	reportSettingsErrors(settings);
	packages.setProgressListener((event) => {
		if (event.type === "start") process.stdout.write(chalk.dim(`${event.message}\n`));
	});

	try {
		switch (options.command) {
			case "install":
				await packages.install(source!, { local: options.local });
				packages.addSource(source!, { local: options.local });
				console.log(chalk.green(`Installed ${source}`));
				return true;
			case "remove": {
				await packages.remove(source!, { local: options.local });
				const removed = packages.removeSource(source!, { local: options.local });
				if (!removed) {
					console.error(chalk.red(`No matching package found for ${source}`));
					process.exitCode = 1;
					return true;
				}
				console.log(chalk.green(`Removed ${source}`));
				return true;
			}
			case "list":
				await listPackages(settings, packages);
				return true;
			case "update":
				await packages.update(source);
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
		if (arg === "-h" || arg === "--help") help = true;
		else if (arg === "-l" || arg === "--local") {
			if (command === "install" || command === "remove") local = true;
			else invalidOption ??= arg;
		} else if (arg.startsWith("-")) invalidOption ??= arg;
		else source ??= arg;
	}
	return { command, source, local, help, invalidOption };
}

function reportSettingsErrors(settings: SettingsRuntime): void {
	for (const { scope, error } of settings.drainErrors()) {
		console.error(chalk.yellow(`Warning (package command, ${scope} settings): ${error.message}`));
		if (error.stack) console.error(chalk.dim(error.stack));
	}
}

async function listPackages(settings: SettingsRuntime, packages: ResourcePackageRuntime): Promise<void> {
	const globalPackages = settings.getGlobalSettings().packages ?? [];
	const projectPackages = settings.getProjectSettings().packages ?? [];
	if (globalPackages.length === 0 && projectPackages.length === 0) {
		console.log(chalk.dim("No packages installed."));
		return;
	}

	const printPackage = async (pkg: (typeof globalPackages)[number], scope: "user" | "project") => {
		const source = typeof pkg === "string" ? pkg : pkg.source;
		console.log(`  ${typeof pkg === "object" ? `${source} (filtered)` : source}`);
		const path = await packages.getInstalledPath(source, scope);
		if (path) console.log(chalk.dim(`    ${path}`));
	};
	if (globalPackages.length > 0) {
		console.log(chalk.bold("User packages:"));
		for (const pkg of globalPackages) await printPackage(pkg, "user");
	}
	if (projectPackages.length > 0) {
		if (globalPackages.length > 0) console.log();
		console.log(chalk.bold("Project packages:"));
		for (const pkg of projectPackages) await printPackage(pkg, "project");
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
	const usage = getPackageCommandUsage(command);
	const detail =
		command === "install"
			? `Install a package and add it to settings.\n\nOptions:\n  -l, --local    Install project-locally (${CONFIG_DIR_NAME}/settings.json)\n\nExamples:\n  ${APP_NAME} install npm:@foo/bar\n  ${APP_NAME} install git:github.com/user/repo\n  ${APP_NAME} install git:git@github.com:user/repo\n  ${APP_NAME} install https://github.com/user/repo\n  ${APP_NAME} install ssh://git@github.com:user/repo\n  ${APP_NAME} install ./local/path`
			: command === "remove"
				? `Remove a package and its source from settings.\n\nOptions:\n  -l, --local    Remove from project settings (${CONFIG_DIR_NAME}/settings.json)\n\nExample:\n  ${APP_NAME} remove npm:@foo/bar`
				: command === "update"
					? "Update installed packages.\nIf <source> is provided, only that package is updated."
					: "List installed packages from user and project settings.";
	console.log(`${chalk.bold("Usage:")}\n  ${usage}\n\n${detail}\n`);
}
