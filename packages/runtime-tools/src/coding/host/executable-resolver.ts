import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type CodingToolExecutable = "fd" | "rg";

export interface CodingToolExecutableResolver {
	readonly resolve: (tool: CodingToolExecutable) => Promise<string | undefined>;
}

export interface LocalCodingToolExecutableResolverOptions {
	readonly binDirectory?: string;
	readonly platform?: NodeJS.Platform;
	readonly fileExists?: (path: string) => boolean;
	readonly commandExists?: (command: string) => boolean;
}

const executableNames: Record<CodingToolExecutable, string> = {
	fd: "fd",
	rg: "rg",
};

function defaultCommandExists(command: string): boolean {
	try {
		const result = spawnSync(command, ["--version"], { stdio: "ignore" });
		return result.error === undefined;
	} catch {
		return false;
	}
}

export function createLocalCodingToolExecutableResolver(
	options: LocalCodingToolExecutableResolverOptions = {},
): CodingToolExecutableResolver {
	const fileExists = options.fileExists ?? existsSync;
	const commandExists = options.commandExists ?? defaultCommandExists;
	const platform = options.platform ?? process.platform;

	return {
		async resolve(tool) {
			const executableName = executableNames[tool];
			if (options.binDirectory) {
				const localPath = join(options.binDirectory, `${executableName}${platform === "win32" ? ".exe" : ""}`);
				if (fileExists(localPath)) return localPath;
			}
			return commandExists(executableName) ? executableName : undefined;
		},
	};
}
