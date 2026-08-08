import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export function resolvePluginDevCliPath(projectDir: string): string {
	const resolvedProjectDir = resolve(projectDir);
	const projectRequire = createRequire(join(resolvedProjectDir, "package.json"));
	let packageEntry: string;
	try {
		packageEntry = projectRequire.resolve("@vetta-org/plugin-vite");
	} catch {
		throw new Error(`plugin-vite is not installed in the plugin project: ${resolvedProjectDir}`);
	}
	const cliPath = join(dirname(packageEntry), "cli.js");
	if (!existsSync(cliPath)) {
		throw new Error(`plugin-vite CLI not found next to package entry: ${cliPath}`);
	}
	return cliPath;
}
