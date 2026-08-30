import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createSentryBuildSetup } from "./sentry-vite";
import { resolveMainBundleExternals } from "./scripts/packaged-native-dependencies.mjs";
import {
	resolveSpeechInputBuildConfig,
	SPEECH_INPUT_ENABLED_ENV,
} from "./scripts/speech-input-build-config.js";

function toolkitSourceAlias(): Plugin {
	return {
		name: "toolkit-source-alias",
		resolveId(source) {
			if (source === "@vetta/toolkit") {
				return resolve(process.cwd(), "../../packages/toolkit/src/index.ts");
			}
			if (source.startsWith("@vetta/toolkit/")) {
				return resolve(process.cwd(), `../../packages/toolkit/src/${source.slice("@vetta/toolkit/".length)}.ts`);
			}
			return null;
		},
	};
}

export default defineConfig(({ mode }) => {
	// 允许通过 VETTA_BUILD_ENV 覆盖构建模式，方便 dist:*:test 等组合脚本从外层注入，
	// 而不必给每个平台/格式的脚本都复刻一遍。
	// 默认值：vite build 命令的 mode（不指定时为 production）。
	const effectiveMode = process.env.VETTA_BUILD_ENV || mode;
	const env = loadEnv(effectiveMode, process.cwd(), "VETTA_");
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("VETTA_") && value !== undefined) env[key] = value;
	}
	const speechInputBuildConfig = resolveSpeechInputBuildConfig({ env });
	const developmentWorkspacePackages =
		effectiveMode === "development"
			? [/^@vetta\/(?:action-rpc|ai|coding-agent|remote-control|runtime-core)(?:\/|$)/]
			: [];
	const sourcemapEnabled = (process.env.VETTA_MAIN_SOURCEMAP ?? env.VETTA_MAIN_SOURCEMAP) === "true";
	const sentry = createSentryBuildSetup(env, "dist/main");

	// 云服务构建期开关：默认关闭（lite）；只有显式 true 才产出完全体。
	const cloudEnabled = env.VETTA_CLOUD_ENABLED === "true";

	// SERVER_URL 只对完全体是必需的——lite 里登录、网关、官方市场都不进产物。
	if (cloudEnabled && !env.VETTA_SERVER_URL) {
		throw new Error(
			`[vite.main.config] VETTA_CLOUD_ENABLED=true 需要 VETTA_SERVER_URL，请检查 .env.${effectiveMode}（mode=${effectiveMode}）`,
		);
	}
	console.log(
		`[vite.main.config] mode=${effectiveMode}, cloud=${cloudEnabled}, VETTA_SERVER_URL=${env.VETTA_SERVER_URL ?? "(unset)"}, speechInput=${speechInputBuildConfig.enabled}`,
	);

	// 将 .env.<mode> 中的 VETTA_* 变量内联到构建产物
	const define: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		define[`process.env.${key}`] = JSON.stringify(value);
	}
	define[`process.env.${SPEECH_INPUT_ENABLED_ENV}`] = JSON.stringify(String(speechInputBuildConfig.enabled));
	// 未配置时按 false（lite）内联，保证 cloud 判断能被常量折叠掉。
	define["process.env.VETTA_CLOUD_ENABLED"] = JSON.stringify(cloudEnabled ? "true" : "false");
	// GitHub 来源只由显式配置注册；固化空值，防止打包后意外继承启动环境的默认源。
	define["process.env.VETTA_OPEN_MARKETPLACE_REPOSITORY"] = JSON.stringify(
		env.VETTA_OPEN_MARKETPLACE_REPOSITORY?.trim() || "",
	);
	define["process.env.VETTA_OPEN_MARKETPLACE_REF"] = JSON.stringify(
		env.VETTA_OPEN_MARKETPLACE_REF?.trim() || "main",
	);
	define["process.env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL"] = JSON.stringify(
		env.VETTA_OPEN_MARKETPLACE_ARCHIVE_URL?.trim() || "",
	);

	return {
		define,
		plugins: [toolkitSourceAlias(), ...sentry.plugins],
		resolve: {
			alias: [
				{
					find: /^@vetta\/remote-desktop$/,
					replacement: resolve(process.cwd(), "../../packages/remote-desktop/src/index.ts"),
				},
				{ find: "x11", replacement: resolve(process.cwd(), "src/main/shims/x11.ts") },
				// Electron 的 Node 没有 node:sqlite。undici 的惰性探测被 Rollup 提升成
				// chunk 顶层静态 import，真实内置模块缺失会让整个 chunk 加载失败，
				// 连带 EnvHttpProxyAgent 装不上（详见 shims/node-sqlite.ts）。
				{ find: "node:sqlite", replacement: resolve(process.cwd(), "src/main/shims/node-sqlite.ts") },
			],
		},
		build: {
			lib: {
				entry: {
					index: resolve(process.cwd(), "src/main/main.ts"),
					// uiohook 宿主 worker 线程独立入口：与 index.js 同目录输出，
					// 运行时由 quickpanel-trigger.ts 按同目录路径拼接后交给 new Worker()。
					"uiohook-worker": resolve(process.cwd(), "src/main/uiohook-worker.ts"),
					...(speechInputBuildConfig.enabled
						? { "speech-input-host": resolve(process.cwd(), "src/main/speech-input-host.ts") }
						: {}),
				},
				formats: ["es"],
				fileName: (_format, entryName) => `${entryName}.js`,
			},
			outDir: resolve(process.cwd(), "dist/main"),
			emptyOutDir: true,
			rollupOptions: {
				external: [
					"electron",
					// node:sqlite 走上面的 shim，不能标成 external：标了 external 就会
					// 在产物里留下对真实内置模块的静态 import，而 Electron 没有它。
					...builtinModules.filter((m) => m !== "sqlite" && m !== "node:sqlite"),
					...builtinModules.filter((m) => m !== "sqlite" && m !== "node:sqlite").map((m) => `node:${m}`),
					...developmentWorkspacePackages,
					// 运行时依赖（photon-node / electron-updater / uiohook-napi / ws / koffi 等）
					// 的清单在 scripts/packaged-native-dependencies.mjs：那里同时驱动
					// prepare-pack 的 staging，两边不会再各写一份而漏掉其中之一。
					...resolveMainBundleExternals({ speechInputEnabled: speechInputBuildConfig.enabled }),
				],
			},
			minify: false,
			sourcemap: sentry.enabled ? "hidden" : sourcemapEnabled,
		},
	};
});
