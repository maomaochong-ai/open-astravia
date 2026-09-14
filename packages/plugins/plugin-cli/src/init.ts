import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readAgentsGuideRevision, renderAgentsGuide } from "./agents-template.js";
import { renderHubAgentsGuide, renderHubReadme, renderHubWorkflow } from "./hub-template.js";

/** 与脚手架一同落地的依赖范围；两个包各自独立发布，不要合成一个版本。 */
export const DEFAULT_SDK_RANGE = "^0.3.2";
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
				"@vetta-org/plugin-cli": "^0.1.1",
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

export interface RefreshGuideOptions {
	/** 覆盖一份没有版本戳的 `AGENTS.md`。缺省拒绝——没有戳的多半是手写的。 */
	readonly force?: boolean;
	/** 只算出内容，不落盘。 */
	readonly dryRun?: boolean;
}

export interface RefreshGuideResult {
	readonly root: string;
	readonly kind: "plugin" | "hub";
	readonly file: string;
	/** 这次生成的说明书正文。`dryRun` 时用它做人工合并。 */
	readonly content: string;
	readonly written: boolean;
}

/**
 * 在已有的工程或能力市场仓库里重写 `AGENTS.md`。
 *
 * `init` 拒绝覆盖已有工程，所以老目录里那份说明书从落地起就再也没变过——它写于某个版本的
 * SDK，之后新增的约定一条都没有。这里只重写这一个文件：它是脚手架里唯一「纯派生、没有用户
 * 内容」的产物，其余文件都可能被改过，不该被一次刷新抹掉。
 *
 * **只有确实由脚手架生成的那份才算纯派生。** 没有版本戳的文件无法与手写内容区分——能力市场
 * 仓库的根 `AGENTS.md` 往往是一整本手写的市场规范——所以一律拒绝覆盖，让调用方拿 `dryRun`
 * 的内容去人工合并，或显式 `force`。宁可少刷新一份，也不能悄悄删掉别人写的东西。
 */
export function refreshAgentsGuide(targetDir: string, options: RefreshGuideOptions = {}): RefreshGuideResult {
	const root = resolve(targetDir);
	const file = join(root, "AGENTS.md");
	const manifestPath = join(root, "plugin.json");
	const hubManifestPath = join(root, ".vetta", "marketplace.json");

	let kind: "plugin" | "hub";
	let content: string;
	if (existsSync(manifestPath)) {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { id?: unknown; name?: unknown };
		const pluginId = typeof manifest.id === "string" ? manifest.id : undefined;
		if (!pluginId) throw new Error(`plugin.json at ${root} has no id`);
		kind = "plugin";
		content = renderAgentsGuide({
			pluginId,
			// 多语言插件的 name 是 `%plugin.name%`，直接当标题会把占位符印在文件开头。
			displayName: resolveManifestText(manifest.name, root, pluginId),
			scripts: readPackageScripts(root),
		});
	} else if (existsSync(hubManifestPath)) {
		const manifest = JSON.parse(readFileSync(hubManifestPath, "utf8")) as { name?: unknown };
		kind = "hub";
		content = renderHubAgentsGuide({
			name: typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : "marketplace",
		});
	} else {
		throw new Error(`Not a plugin project or marketplace repository: ${root}`);
	}

	if (!options.dryRun) assertSafeToOverwrite(file, options.force === true);
	if (options.dryRun) return { root, kind, file, content, written: false };
	writeFileSync(file, content, "utf8");
	return { root, kind, file, content, written: true };
}

/** 已有文件必须是本模板生成的（带版本戳）才允许重写。 */
function assertSafeToOverwrite(file: string, force: boolean): void {
	if (force || !existsSync(file)) return;
	if (readAgentsGuideRevision(readFileSync(file, "utf8")) !== undefined) return;
	throw new Error(
		`${file} has no vetta-guide-revision marker, so it looks hand-written rather than scaffolded. ` +
			"Refusing to overwrite it. Review the new template with `--dry-run`, merge what you want by hand, " +
			"or pass `--force` to replace the file.",
	);
}

/**
 * 解析 manifest 里的 `%key%` 占位；解析不到就退回插件 id。
 *
 * 规则与宿主一致：整串恰好是 `%key%` 才查表，否则原样返回。
 */
function resolveManifestText(raw: unknown, root: string, fallback: string): string {
	if (typeof raw !== "string" || raw.length === 0) return fallback;
	const match = /^%([^%]+)%$/.exec(raw);
	if (!match) return raw;
	const key = match[1]!;
	const pluginManifest = readJsonFile(join(root, "plugin.json")) as { defaultLocale?: unknown } | undefined;
	const locale = typeof pluginManifest?.defaultLocale === "string" ? pluginManifest.defaultLocale : "zh";
	for (const candidate of [locale, "zh", "en"]) {
		const table = readJsonFile(join(root, "locales", `${candidate}.json`));
		const value = table?.[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return fallback;
}

/** 工程实际有的 npm scripts；读不到就当没有。 */
function readPackageScripts(root: string): string[] {
	const pkg = readJsonFile(join(root, "package.json")) as { scripts?: unknown } | undefined;
	const scripts = pkg?.scripts;
	if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return [];
	return Object.keys(scripts as Record<string, unknown>);
}

function readJsonFile(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

const HUB_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface InitHubInput {
	readonly targetDir: string;
	/** 市场名（slug）。 */
	readonly name: string;
	readonly repository: string;
	/** 本市场的能力所支持的最老 Vetta 版本。 */
	readonly minAppVersion: string;
}

export interface InitHubResult {
	readonly root: string;
	readonly name: string;
	readonly files: readonly string[];
}

/** 能力按类型分目录；空目录留 .gitkeep，否则 git 不会带上它们，作者得自己猜该放哪。 */
const HUB_ABILITY_DIRS = ["plugins", "mcp", "skills", "scenes"] as const;

export function initHubRepository(input: InitHubInput): InitHubResult {
	if (!HUB_NAME_PATTERN.test(input.name)) {
		throw new Error(`Invalid marketplace name ${JSON.stringify(input.name)}: use lowercase kebab-case`);
	}
	let repository: URL;
	try {
		repository = new URL(input.repository);
	} catch {
		throw new Error(`Invalid repository URL: ${input.repository}`);
	}
	if (repository.protocol !== "https:") throw new Error("Repository URL must use https://");
	if (!APP_VERSION_PATTERN.test(input.minAppVersion)) {
		throw new Error(`Invalid --min-app-version ${JSON.stringify(input.minAppVersion)}: expected a version like 0.55.0`);
	}

	const root = resolve(input.targetDir);
	const manifestRelativePath = join(".vetta", "marketplace.json");
	if (existsSync(join(root, manifestRelativePath))) {
		throw new Error(`Refusing to overwrite an existing marketplace at ${root}`);
	}

	const files: Record<string, string> = {
		[manifestRelativePath]: json({
			schemaVersion: 2,
			name: input.name,
			marketplaceVersion: "1.0.0",
			repository: repository.toString().replace(/\/$/, ""),
			minAppVersion: input.minAppVersion,
			abilities: [],
		}),
		"AGENTS.md": renderHubAgentsGuide({ name: input.name }),
		"README.md": renderHubReadme({ name: input.name, repository: repository.toString().replace(/\/$/, "") }),
		[join(".github", "workflows", "marketplace.yml")]: renderHubWorkflow(),
		// dist/ 刻意不忽略：客户端直接读能力目录安装，不会替作者构建。
		".gitignore": "node_modules/\nrelease/\n",
	};
	for (const dir of HUB_ABILITY_DIRS) files[join("abilities", dir, ".gitkeep")] = "";

	for (const [relativePath, content] of Object.entries(files)) {
		const target = join(root, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content, "utf8");
	}

	return { root, name: input.name, files: Object.keys(files).sort() };
}
