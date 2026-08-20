import { validateDesktopBuildEnvironment } from "./desktop-build-environment.mjs";
import { loadBuildEnv } from "./load-build-env.mjs";

try {
	const mode = loadBuildEnv();
	const config = validateDesktopBuildEnvironment({ env: process.env, mode });
	const update =
		config.updateConfig.provider === "generic"
			? config.updateConfig.url
			: `${config.updateConfig.owner}/${config.updateConfig.repo}`;
	console.log(`[desktop-build-env] ${config.edition} build configuration is valid`);
	console.log(`[desktop-build-env] mode=${config.mode}, targets=${config.platformTags.join(",")}`);
	console.log(
		`[desktop-build-env] updater=${config.updateConfig.provider}:${update}, tenant=${config.pluginSelection.name ?? "(none)"}`,
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
