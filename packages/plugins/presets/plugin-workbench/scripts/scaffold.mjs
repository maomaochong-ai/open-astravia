#!/usr/bin/env node
/**
 * Scaffold a minimal Vetta MF plugin project under a target directory.
 * Usage: node scaffold.mjs <targetDir> --id <id> --name <displayName> [--semver-sdk ^0.1.1] [--semver-vite ^0.0.5]
 */
import { mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";

function parseArgs(argv) {
	// sdk / vite 版本各自独立发布，不要合成一个参数。
	const out = { target: null, id: null, name: null, sdk: "^0.1.1", vite: "^0.0.5" };
	const rest = [...argv];
	out.target = rest.shift() ?? null;
	while (rest.length) {
		const key = rest.shift();
		if (key === "--id") out.id = rest.shift();
		else if (key === "--name") out.name = rest.shift();
		else if (key === "--semver-sdk") out.sdk = rest.shift();
		else if (key === "--semver-vite") out.vite = rest.shift();
		else throw new Error(`Unknown arg: ${key}`);
	}
	return out;
}

function remoteNameFromId(id) {
	return id.replace(/-/g, "_").replace(/[^A-Za-z0-9_$]/g, "_");
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

const args = parseArgs(process.argv.slice(2));
if (!args.target || !args.id || !args.name) {
	console.error(
		"Usage: node scaffold.mjs <targetDir> --id <id> --name <displayName> [--semver-sdk ^0.1.1] [--semver-vite ^0.0.5]",
	);
	process.exit(2);
}
if (!/^[a-z][a-z0-9-]{0,62}$/.test(args.id)) {
	console.error("Invalid id: use lowercase kebab-case starting with a letter");
	process.exit(2);
}

const root = resolve(args.target);
if (await exists(join(root, "plugin.json"))) {
	console.error(`Refusing to overwrite existing plugin at ${root}`);
	process.exit(1);
}

const remote = remoteNameFromId(args.id);
const files = {
	"plugin.json": `${JSON.stringify(
		{
			id: args.id,
			name: args.name,
			version: "0.1.0",
			pluginApiVersion: "^1.0.0",
			runtime: "module-federation",
			entry: "dist/mf-manifest.json",
			moduleFederation: { remoteName: remote, expose: "./plugin" },
			styles: ["dist/style.css"],
			permissions: [],
			description: args.name,
			author: "Vetta User",
			icon: "solar:widget-add-bold",
			guidingWords: [],
		},
		null,
		"\t",
	)}\n`,
	"package.json": `${JSON.stringify(
		{
			name: args.id,
			version: "0.1.0",
			private: true,
			type: "module",
			scripts: {
				build: "vite build",
				check: "tsc --noEmit",
				pack: "vetta-plugin pack",
				validate: "vetta-plugin validate",
			},
			devDependencies: {
				"@tailwindcss/vite": "^4.1.12",
				"@types/react": "^19.1.1",
				"@types/react-dom": "^19.1.1",
				"@vetta-org/plugin-sdk": args.sdk,
				"@vetta-org/plugin-vite": args.vite,
				react: "19.1.1",
				"react-dom": "19.1.1",
				tailwindcss: "^4.1.12",
				typescript: "^5.9.2",
				vite: "^7.1.7",
			},
		},
		null,
		"\t",
	)}\n`,
	"tsconfig.json": `${JSON.stringify(
		{
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
		},
		null,
		"\t",
	)}\n`,
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
// Tailwind pipeline only — do NOT add business CSS rules (pollutes host UI).
import "./style.css";

export default definePlugin({
	activate() {
		// Style UI with Tailwind className only (see styling-and-pitfalls).
	},
});
`,
	"src/style.css": `/* Tailwind entry only. No business selectors — they inject into the host page. */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
`,
	".gitignore": `dist/\nrelease/\nnode_modules/\n`,
};

await mkdir(join(root, "src"), { recursive: true });
for (const [rel, content] of Object.entries(files)) {
	await writeFile(join(root, rel), content, "utf8");
}

console.log(
	JSON.stringify(
		{
			ok: true,
			root,
			id: args.id,
			name: args.name,
			hint: "Run: npm install && npm run build  (or workbench build-and-pack.mjs)",
		},
		null,
		2,
	),
);
