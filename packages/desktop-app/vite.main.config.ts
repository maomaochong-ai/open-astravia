import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createSentryBuildSetup } from "./sentry-vite";
import {
	resolveSpeechInputBuildConfig,
	SPEECH_INPUT_ENABLED_ENV,
} from "./scripts/speech-input-build-config.js";

function workspaceSourceAlias(): Plugin {
	return {
		name: "workspace-source-alias",
		resolveId(source) {
			if (source === "@vetta/toolkit") {
				return resolve(process.cwd(), "../toolkit/src/index.ts");
			}
			if (source.startsWith("@vetta/toolkit/")) {
				return resolve(process.cwd(), `../toolkit/src/${source.slice("@vetta/toolkit/".length)}.ts`);
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
			? [/^@vetta\/(?:action-rpc|ai|coding-agent|runtime-core)(?:\/|$)/]
			: [];
	const sourcemapEnabled = (process.env.VETTA_MAIN_SOURCEMAP ?? env.VETTA_MAIN_SOURCEMAP) === "true";
	const sentry = createSentryBuildSetup(env, "dist/main");

	if (!env.VETTA_SERVER_URL) {
		throw new Error(
			`[vite.main.config] VETTA_SERVER_URL 未配置，请检查 .env.${effectiveMode}（mode=${effectiveMode}）`,
		);
	}
	console.log(
		`[vite.main.config] mode=${effectiveMode}, VETTA_SERVER_URL=${env.VETTA_SERVER_URL}, speechInput=${speechInputBuildConfig.enabled}`,
	);

	// 将 .env.<mode> 中的 VETTA_* 变量内联到构建产物
	const define: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		define[`process.env.${key}`] = JSON.stringify(value);
	}
	define[`process.env.${SPEECH_INPUT_ENABLED_ENV}`] = JSON.stringify(String(speechInputBuildConfig.enabled));

	return {
		define,
		plugins: [workspaceSourceAlias(), ...sentry.plugins],
		resolve: {
			alias: {
				x11: resolve(process.cwd(), "src/main/shims/x11.ts"),
				// Electron 的 Node 没有 node:sqlite。undici 的惰性探测被 Rollup 提升成
				// chunk 顶层静态 import，真实内置模块缺失会让整个 chunk 加载失败，
				// 连带 EnvHttpProxyAgent 装不上（详见 shims/node-sqlite.ts）。
				"node:sqlite": resolve(process.cwd(), "src/main/shims/node-sqlite.ts"),
			},
		},
		build: {
			lib: {
				entry: {
					index: resolve(process.cwd(), "src/main/main.ts"),
					// uiohook 宿主 utilityProcess 独立入口：与 index.js 同目录输出，
					// 运行时以 new URL("./uiohook-host.js", import.meta.url) 定位。
					"uiohook-host": resolve(process.cwd(), "src/main/uiohook-host.ts"),
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
					// Photon-node ships as CJS with __dirname-based WASM loading.
					// Inlining it into this ESM bundle makes Node interpret its .js
					// as ESM (because desktop-app/package.json has "type":"module"),
					// which breaks __dirname and silently disables image resize ->
					// large images reach the model at original resolution and OOM
					// local VL backends.
					"@silvia-odwyer/photon-node",
					// electron-updater 运行时读取 app-update.yml，并按平台加载差分更新实现；
					// 保留为 external，随 staged node_modules 一起打包。
					"builder-util-runtime",
					"electron-updater",
					// uiohook-napi 是原生模块（.node + node-gyp-build 定位 prebuild），
					// 不能打进 bundle，运行时从 node_modules 解析。
					"uiohook-napi",
					// electron-liquid-glass 同为原生模块（node-gyp-build + prebuilds），
					// 提供 macOS 液态玻璃/磨砂玻璃效果，运行时从 node_modules 解析。
					"electron-liquid-glass",
					// Windows-only Sherpa-ONNX native runtime; model files are staged as extraResources at build time.
					...(speechInputBuildConfig.enabled ? ["sherpa-onnx-win-x64"] : []),
				],
			},
			minify: false,
			sourcemap: sentry.enabled ? "hidden" : sourcemapEnabled,
		},
	};
});
