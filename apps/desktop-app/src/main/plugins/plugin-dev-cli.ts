import { createRequire } from "node:module";
import { join, resolve } from "node:path";

function moduleErrorCode(error: unknown): string | undefined {
	return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;
}

export function resolvePluginDevCliPath(projectDir: string): string {
	const resolvedProjectDir = resolve(projectDir);
	const projectRequire = createRequire(join(resolvedProjectDir, "package.json"));
	try {
		return projectRequire.resolve("@vetta-org/plugin-vite/cli");
	} catch (error) {
		if (moduleErrorCode(error) === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
			throw new Error(
				`The installed plugin-vite does not expose its development CLI; update @vetta-org/plugin-vite in ${resolvedProjectDir}`,
				{ cause: error },
			);
		}
		throw new Error(`plugin-vite development CLI is not installed or built in ${resolvedProjectDir}`, {
			cause: error,
		});
	}
}
