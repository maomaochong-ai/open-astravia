import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createOpenSourceBuildEnvironment } from "./desktop-build-environment.mjs";
import { loadBuildEnv } from "./load-build-env.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const loadedEnvironment = { ...process.env, VETTA_BUILD_ENV: "opensource" };
loadBuildEnv({ env: loadedEnvironment, cwd: projectRoot });
const environment = createOpenSourceBuildEnvironment(loadedEnvironment);
const forwardedArguments = process.argv.slice(2);
if (forwardedArguments[0] === "--") forwardedArguments.shift();

const result = spawnSync("bun", ["run", "dist:desktop", "--", ...forwardedArguments], {
	cwd: projectRoot,
	env: environment,
	stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
