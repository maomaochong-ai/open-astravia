/**
 * Validate the repository's Turborepo cache-safety and entry-point contracts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, isDirectRun, ok, repoRoot, WORKSPACE_PACKAGES } from "./lib.mjs";

const REQUIRED_GLOBAL_DEPENDENCIES = ["tsconfig.base.json", ".env", ".env.*"];
const REQUIRED_BUILD_INPUTS = ["$TURBO_DEFAULT$", "!test/**", "!tests/**", "!README*", "!CHANGELOG*"];
const REQUIRED_BUILD_ENV = ["NODE_ENV", "VETTA_PLUGIN_DEV_WATCH", "VETTA_PLUGIN_DOCS_SRC", "VETD_SRC"];
const REQUIRED_BUILD_OUTPUTS = ["dist/**", "release/**", ".next/**", "!.next/cache/**"];
const REQUIRED_DESKTOP_BUILD_ENV = ["NODE_ENV", "VETTA_*", "VETD_*"];
const REQUIRED_DOCS_BUILD_ENV = ["DOCS_SITE_URL", "NODE_ENV"];
const PLUGIN_WORKBENCH_DOCS_INPUT = "$TURBO_ROOT$/docs/plugin/**";

function missingValues(actual, required) {
	const values = new Set(actual ?? []);
	return required.filter((value) => !values.has(value));
}

export function findTurboConfigurationProblems({
	rootManifest,
	turboConfig,
	workspacePackages,
	desktopManifest,
	vercelConfig,
}) {
	const problems = [];
	const build = turboConfig.tasks?.build ?? {};
	const desktopBuild = turboConfig.tasks?.["@vetta/desktop#build"] ?? {};
	const docsBuild = turboConfig.tasks?.["@vetta/docs-site#build"] ?? {};
	const pluginWorkbenchBuild = turboConfig.tasks?.["@vetta/plugin-plugin-workbench#build"] ?? {};

	for (const value of missingValues(turboConfig.globalDependencies, REQUIRED_GLOBAL_DEPENDENCIES)) {
		problems.push(`turbo globalDependencies 缺少 ${value}`);
	}
	if (turboConfig.envMode !== "strict") {
		problems.push("turbo envMode 必须为 strict");
	}
	for (const value of missingValues(build.inputs, REQUIRED_BUILD_INPUTS)) {
		problems.push(`turbo build.inputs 缺少 ${value}`);
	}
	for (const value of missingValues(build.env, REQUIRED_BUILD_ENV)) {
		problems.push(`turbo build.env 缺少 ${value}`);
	}
	for (const value of missingValues(desktopBuild.env, REQUIRED_DESKTOP_BUILD_ENV)) {
		problems.push(`turbo Desktop build.env 缺少 ${value}`);
	}
	for (const value of missingValues(docsBuild.env, REQUIRED_DOCS_BUILD_ENV)) {
		problems.push(`turbo docs build.env 缺少 ${value}`);
	}
	for (const value of missingValues(docsBuild.inputs, REQUIRED_BUILD_INPUTS)) {
		problems.push(`turbo docs build.inputs 缺少 ${value}`);
	}
	for (const value of missingValues(docsBuild.outputs, REQUIRED_BUILD_OUTPUTS)) {
		problems.push(`turbo docs build.outputs 缺少 ${value}`);
	}
	if (!docsBuild.dependsOn?.includes("^build")) {
		problems.push('turbo docs build.dependsOn 必须包含 "^build"');
	}
	for (const value of missingValues(pluginWorkbenchBuild.env, REQUIRED_BUILD_ENV)) {
		problems.push(`plugin-workbench build.env 缺少 ${value}`);
	}
	for (const value of missingValues(pluginWorkbenchBuild.outputs, REQUIRED_BUILD_OUTPUTS)) {
		problems.push(`plugin-workbench build.outputs 缺少 ${value}`);
	}
	if (!pluginWorkbenchBuild.dependsOn?.includes("^build")) {
		problems.push('plugin-workbench build.dependsOn 必须包含 "^build"');
	}
	if (!pluginWorkbenchBuild.inputs?.includes(PLUGIN_WORKBENCH_DOCS_INPUT)) {
		problems.push(`plugin-workbench build.inputs 缺少 ${PLUGIN_WORKBENCH_DOCS_INPUT}`);
	}
	if (!build.dependsOn?.includes("^build")) {
		problems.push('turbo build.dependsOn 必须包含 "^build"');
	}
	if (desktopBuild.cache !== false) {
		problems.push("Desktop 完整 build 必须保持 cache: false");
	}
	if (!desktopBuild.dependsOn?.includes("@vetta-org/plugin-vite#build")) {
		problems.push("Desktop build 必须显式依赖 @vetta-org/plugin-vite#build");
	}
	if (turboConfig.remoteCache?.enabled !== false) {
		problems.push("Remote Cache 在完成跨平台与凭证验收前必须保持关闭");
	}
	if (turboConfig.remoteCache?.signature !== true) {
		problems.push("Remote Cache 配置必须预先启用制品签名校验");
	}

	const manifests = [{ name: "root", scripts: rootManifest.scripts ?? {} }, ...workspacePackages];
	for (const manifest of manifests) {
		for (const [scriptName, command] of Object.entries(manifest.scripts ?? {})) {
			if (typeof command === "string" && command.includes("--env-mode=loose")) {
				problems.push(`${manifest.name ?? manifest.key}#${scriptName} 不得覆盖 strict env mode`);
			}
		}
	}

	for (const scriptName of ["build", "build:all", "build:desktop", "build:cli", "build:docs"]) {
		const command = rootManifest.scripts?.[scriptName];
		if (typeof command !== "string" || !command.includes("turbo run build")) {
			problems.push(`root#${scriptName} 必须通过 turbo run build`);
			continue;
		}
		if (!command.includes("--summarize")) {
			problems.push(`root#${scriptName} 必须生成 Turbo run summary`);
		}
	}
	if (!rootManifest.scripts?.build?.includes("build:preset:prebuilt")) {
		problems.push("root#build 必须复用 Turbo 已构建的 plugin tooling");
	}
	if (!rootManifest.scripts?.["build:cli"]?.includes("build:preset:prebuilt")) {
		problems.push("root#build:cli 必须复用 Turbo 已构建的 plugin tooling");
	}
	if (!desktopManifest.scripts?.build?.includes("build:presets:prebuilt")) {
		problems.push("Desktop build 必须复用 Turbo 已构建的 plugin tooling");
	}
	if (!desktopManifest.scripts?.["build:presets:prebuilt"]?.includes("VETTA_SKIP_PLUGIN_TOOLING_BUILD=1")) {
		problems.push("Desktop 缺少 prebuilt preset 构建入口");
	}

	if (!vercelConfig.buildCommand?.includes("build:docs")) {
		problems.push("Vercel docs build 必须复用 root#build:docs");
	}
	if (!vercelConfig.ignoreCommand?.includes("bunx turbo query affected")) {
		problems.push("Vercel docs ignoreCommand 必须使用固定版本 Turbo 的 query affected");
	}
	if (vercelConfig.ignoreCommand?.includes("turbo-ignore")) {
		problems.push("Vercel docs 不得继续使用已弃用的 turbo-ignore");
	}

	return problems;
}

export function readTurboConfiguration(root = repoRoot) {
	return {
		rootManifest: JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
		turboConfig: JSON.parse(readFileSync(join(root, "turbo.json"), "utf8")),
		workspacePackages: WORKSPACE_PACKAGES,
		desktopManifest: JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8")),
		vercelConfig: JSON.parse(readFileSync(join(root, "apps/docs-site/vercel.json"), "utf8")),
	};
}

export function main() {
	const problems = findTurboConfigurationProblems(readTurboConfiguration());
	if (problems.length === 0) {
		ok("[turbo-config] cache and entry-point contracts passed");
		return 0;
	}
	for (const problem of problems) fail(`[turbo-config] ${problem}`);
	return 1;
}

if (isDirectRun(import.meta.url)) {
	process.exit(main());
}
