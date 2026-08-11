import path, { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import ts from "typescript";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { createSentryBuildSetup, readValue } from "./sentry-vite";

function themeDevelopmentReload(): Plugin {
	const themeSourceDir = resolve(__dirname, "../themes/builtin/xianxia/src");
	return {
		name: "vetta-theme-development-reload",
		configureServer(server) {
			const reloadRenderer = (file: string): void => {
				const relativePath = path.relative(themeSourceDir, file);
				if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return;
				server.ws.send({ type: "full-reload" });
			};
			server.watcher.add(themeSourceDir);
			server.watcher.on("add", reloadRenderer);
			server.watcher.on("change", reloadRenderer);
			server.watcher.on("unlink", reloadRenderer);
			server.httpServer?.once("close", () => {
				server.watcher.off("add", reloadRenderer);
				server.watcher.off("change", reloadRenderer);
				server.watcher.off("unlink", reloadRenderer);
			});
		},
	};
}

function hostApiAccessTransform(): Plugin {
	const rendererRoot = path.resolve(__dirname, "src/renderer").replaceAll("\\", "/");
	const hostApiModule = `${rendererRoot}/shared/host-api.ts`;
	return {
		name: "vetta-host-api-access",
		enforce: "pre",
		transform(code, id) {
			const cleanId = id.split("?", 1)[0]?.replaceAll("\\", "/");
			if (!cleanId?.startsWith(`${rendererRoot}/`) || cleanId === hostApiModule || !/\.tsx?$/.test(cleanId)) {
				return null;
			}

			const scriptKind = cleanId.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
			const sourceFile = ts.createSourceFile(cleanId, code, ts.ScriptTarget.Latest, true, scriptKind);
			const replacements: Array<{ start: number; end: number }> = [];
			const visit = (node: ts.Node): void => {
				if (
					ts.isPropertyAccessExpression(node) &&
					node.name.text === "vetta" &&
					ts.isIdentifier(node.expression) &&
					node.expression.text === "window"
				) {
					replacements.push({ start: node.getStart(sourceFile), end: node.getEnd() });
				}
				ts.forEachChild(node, visit);
			};
			visit(sourceFile);
			if (replacements.length === 0) return null;

			let transformed = code;
			for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
				transformed = `${transformed.slice(0, replacement.start)}__vettaHostApi${transformed.slice(replacement.end)}`;
			}
			return {
				code: `import { hostApi as __vettaHostApi } from "@shared/host-api";\n${transformed}`,
				map: null,
			};
		},
	};
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "VETTA_");
	const themeDevelopmentEnabled =
		(process.env.VETTA_THEME_DEV_SERVER ?? env.VETTA_THEME_DEV_SERVER) === "1";
	const rawDevServerPort = process.env.VETTA_DESKTOP_DEV_PORT ?? env.VETTA_DESKTOP_DEV_PORT ?? "3020";
	const devServerPort = Number(rawDevServerPort);
	if (!Number.isInteger(devServerPort) || devServerPort < 1 || devServerPort > 65_535) {
		throw new Error(`Invalid VETTA_DESKTOP_DEV_PORT: ${rawDevServerPort}`);
	}
	// 外观「界面主题」区段：默认隐藏；VETTA_SHOW_UI_THEME=true 时展示（shell > .env）
	const showUiTheme = process.env.VETTA_SHOW_UI_THEME ?? env.VETTA_SHOW_UI_THEME ?? "";
	const sentry = createSentryBuildSetup(env, "dist/renderer");

	return {
		define: {
			"process.env.VETTA_SHOW_UI_THEME": JSON.stringify(showUiTheme),
			"process.env.VETTA_SENTRY_ENABLED": JSON.stringify(
				readValue(env, "VETTA_SENTRY_DSN") ? "true" : "false",
			),
			"process.env.VETTA_POSTHOG_KEY": JSON.stringify(readValue(env, "VETTA_POSTHOG_KEY") ?? ""),
			"process.env.VETTA_POSTHOG_HOST": JSON.stringify(readValue(env, "VETTA_POSTHOG_HOST") ?? ""),
			"process.env.VETTA_POSTHOG_REPLAY_ENABLED": JSON.stringify(
				readValue(env, "VETTA_POSTHOG_REPLAY_ENABLED") ?? "",
			),
			"process.env.VETTA_POSTHOG_REPLAY_SAMPLE_RATE": JSON.stringify(
				readValue(env, "VETTA_POSTHOG_REPLAY_SAMPLE_RATE") ?? "",
			),
		},
		plugins: [
			hostApiAccessTransform(),
			react(),
			tailwindcss(),
			...(themeDevelopmentEnabled ? [themeDevelopmentReload()] : []),
			...sentry.plugins,
		],
		root: "src/renderer",
		base: "./",
		resolve: {
			alias: {
				"@shared": path.resolve(__dirname, "./src/renderer/shared"),
				"@domains": path.resolve(__dirname, "./src/renderer/domains"),
				"@vetta/theme-sdk": path.resolve(__dirname, "../theme-sdk/src"),
				"@vetta/theme-ui": path.resolve(__dirname, "../theme-ui/src"),
				"@vetta/ui": path.resolve(__dirname, "../ui/src/index.ts"),
				"@": path.resolve(__dirname, "./src"),
			},
		},
		worker: {
			format: "es",
		},
		build: {
			outDir: resolve(process.cwd(), "dist/renderer"),
			emptyOutDir: false,
			sourcemap: sentry.enabled ? "hidden" : false,
			rollupOptions: {
				input: {
					main: resolve(__dirname, "src/renderer/index.html"),
					pet: resolve(__dirname, "src/renderer/pet.html"),
					quickpanel: resolve(__dirname, "src/renderer/quickpanel.html"),
					onboarding: resolve(__dirname, "src/renderer/onboarding.html"),
				},
			},
		},
		server: {
			// Keep off 3000 (packages/site Next) and 3010 (xianxia theme dev).
			host: "127.0.0.1",
			port: devServerPort,
			strictPort: true,
		},
	};
});
