import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { renderAgentsGuide } from "./agents-template.js";
import { findPluginHub } from "./workspace.js";

/** 与脚手架一同落地的依赖范围；两个包各自独立发布，不要合成一个版本。 */
export const DEFAULT_SDK_RANGE = "^0.3.0";
export const DEFAULT_VITE_RANGE = "^0.2.0";

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export interface InitPluginInput {
	readonly targetDir: string;
	readonly pluginId: string;
	readonly displayName: string;
	readonly sdkRange?: string;
	readonly viteRange?: string;
	/** 在 hub 里默认把新插件登记进 .vetta/marketplace.json；置 false 跳过。 */
	readonly registerInHub?: boolean;
}

export interface InitPluginResult {
	readonly root: string;
	readonly pluginId: string;
	readonly files: readonly string[];
	/** 登记进了哪个 hub 清单；没有 hub 或跳过登记时为 undefined。 */
	readonly hubManifestPath?: string;
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
	const hub = findPluginHub(dirname(root));
	const registerInHub = input.registerInHub !== false && hub !== undefined;

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
		".gitignore": "dist/\nrelease/\nnode_modules/\n",
		"AGENTS.md": renderAgentsGuide({
			pluginId: input.pluginId,
			displayName: input.displayName,
			inHub: registerInHub,
		}),
	};

	mkdirSync(join(root, "src"), { recursive: true });
	for (const [relativePath, content] of Object.entries(files)) {
		writeFileSync(join(root, relativePath), content, "utf8");
	}

	let hubManifestPath: string | undefined;
	if (registerInHub && hub) {
		hubManifestPath = registerPluginInHub(hub.root, hub.manifestPath, root, input);
	}

	return { root, pluginId: input.pluginId, files: Object.keys(files).sort(), ...(hubManifestPath ? { hubManifestPath } : {}) };
}

/**
 * 把新插件登记进 hub 的 `.vetta/marketplace.json`。
 *
 * 手动维护这份索引是一仓多插件最容易漏的一步：插件建好了、能装能跑，市场上却看不到它。
 * 元数据全都能从 plugin.json 推导，没有理由让人再抄一遍。
 */
function registerPluginInHub(
	hubRoot: string,
	manifestPath: string,
	pluginRoot: string,
	input: InitPluginInput,
): string {
	const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`Malformed marketplace manifest: ${manifestPath}`);
	}
	const manifest = raw as Record<string, unknown>;
	const abilities = Array.isArray(manifest.abilities) ? [...(manifest.abilities as unknown[])] : [];
	const duplicate = abilities.some(
		(entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).slug === input.pluginId,
	);
	if (duplicate) throw new Error(`${input.pluginId} is already listed in ${manifestPath}`);

	abilities.push({
		type: "plugin",
		slug: input.pluginId,
		name: input.displayName,
		description: "",
		version: "0.1.0",
		source: { path: relative(hubRoot, pluginRoot).split("\\").join("/") },
		config: { api_version: "^2.0.0", permissions: [] },
	});
	manifest.abilities = abilities;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`, "utf8");
	return manifestPath;
}
