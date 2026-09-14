import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderAgentsGuide } from "./agents-template.js";

/** 与脚手架一同落地的依赖范围；两个包各自独立发布，不要合成一个版本。 */
export const DEFAULT_SDK_RANGE = "^0.3.1";
export const DEFAULT_VITE_RANGE = "^0.2.0";

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export interface InitPluginInput {
	readonly targetDir: string;
	readonly pluginId: string;
	readonly displayName: string;
	readonly sdkRange?: string;
	readonly viteRange?: string;
}

export interface InitPluginResult {
	readonly root: string;
	readonly pluginId: string;
	readonly files: readonly string[];
}

function remoteNameFromId(pluginId: string): string {
	return pluginId.replace(/-/g, "_").replace(/[^A-Za-z0-9_$]/g, "_");
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

export function initPluginProject(input: InitPluginInput): InitPluginResult {
	if (!PLUGIN_ID_PATTERN.test(input.pluginId)) {
		throw new Error(`Invalid plugin id ${JSON.stringify(input.pluginId)}: use lowercase kebab-case starting with a letter`);
	}
	const root = resolve(input.targetDir);
	if (existsSync(join(root, "plugin.json"))) {
		throw new Error(`Refusing to overwrite an existing plugin at ${root}`);
	}

	const remote = remoteNameFromId(input.pluginId);

	const files: Record<string, string> = {
		"plugin.json": json({
			id: input.pluginId,
			name: input.displayName,
			version: "0.1.0",
			pluginApiVersion: "^2.0.0",
			entry: "dist/mf-manifest.json",
			moduleFederation: { remoteName: remote, expose: "./plugin" },
			styles: ["dist/style.css"],
			permissions: [],
			description: input.displayName,
			author: "",
			icon: "solar:widget-add-bold",
			guidingWords: [],
		}),
		"package.json": json({
			name: input.pluginId,
			version: "0.1.0",
			private: true,
			type: "module",
			scripts: {
				dev: "vetta-plugin dev",
				build: "vite build",
				check: "tsc --noEmit",
				pack: "vetta-plugin pack",
				validate: "vetta-plugin validate",
				docs: "vetta-plugin-cli docs",
				// 一条命令走完「构建 → 打包 → 装进正在运行的 Vetta」。
				"install:vetta": "vite build && vetta-plugin pack && vetta-plugin-cli add .",
			},
			devDependencies: {
				"@tailwindcss/vite": "^4.1.12",
				"@types/react": "^19.1.1",
				"@types/react-dom": "^19.1.1",
				"@vetta-org/plugin-cli": "^0.1.0",
				"@vetta-org/plugin-sdk": input.sdkRange ?? DEFAULT_SDK_RANGE,
				"@vetta-org/plugin-vite": input.viteRange ?? DEFAULT_VITE_RANGE,
				react: "19.1.1",
				"react-dom": "19.1.1",
				tailwindcss: "^4.1.12",
				typescript: "^5.9.2",
				vite: "^7.1.7",
			},
		}),
		"tsconfig.json": json({
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				lib: ["ES2022", "DOM", "DOM.Iterable"],
				strict: true,
				esModuleInterop: true,
				skipLibCheck: true,
				moduleResolution: "bundler",
				jsx: "react-jsx",
				jsxImportSource: "react",
				noEmit: true,
			},
			include: ["src/**/*.ts", "src/**/*.tsx"],
		}),
		"vite.config.ts": `import tailwindcss from "@tailwindcss/vite";
import { vettaPluginFederation } from "@vetta-org/plugin-vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [
		tailwindcss(),
		vettaPluginFederation({
			name: "${remote}",
			entry: "./src/index.tsx",
		}),
	],
	esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
`,
		"src/index.tsx": `import { definePlugin } from "@vetta-org/plugin-sdk";
// Tailwind pipeline only — business CSS here would leak into the host page.
import "./style.css";

export default definePlugin({
	activate(ctx) {
		// Read the manual before adding contributions: npx vetta-plugin-cli docs
		void ctx;
	},
});
`,
		"src/style.css": `/* Tailwind entry only. No business selectors — they inject into the host page. */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
`,
		// dist/ 刻意不忽略：插件通过仓库目录分发时，宿主直接读 plugin.json 指向的 entry 与
		// styles，它不会替你构建——目录里没有构建产物就装不上，而且那是一个只在别人机器上
		// 复现的失败。
		".gitignore": "release/\nnode_modules/\n",
		"AGENTS.md": renderAgentsGuide({ pluginId: input.pluginId, displayName: input.displayName }),
	};

	mkdirSync(join(root, "src"), { recursive: true });
	for (const [relativePath, content] of Object.entries(files)) {
		writeFileSync(join(root, relativePath), content, "utf8");
	}

	return { root, pluginId: input.pluginId, files: Object.keys(files).sort() };
}
