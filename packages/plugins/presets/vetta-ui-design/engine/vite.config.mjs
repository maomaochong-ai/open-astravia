// Vetta Design Engine — shared vite template (materialized to ~/.vetta/design-engine/<version>/).
// The design source dir (x.vetd.d/) is mounted via the VETD_SRC env var; the engine itself
// never contains user content. See ADR-0053.
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const engineRoot = dirname(fileURLToPath(import.meta.url));
const designRoot = resolve(process.env.VETD_SRC ?? resolve(process.cwd(), "design"));
const designRootPosix = designRoot.replaceAll("\\", "/");

/**
 * Babel plugin: tag every JSX element in design sources with
 * `data-vetd-source="frames/login.tsx:42"` so the canvas can map a selected DOM
 * node back to its exact source location. Dev-serve only — production/export
 * builds stay clean.
 */
function vetdSourceAttr({ types: t }) {
	return {
		name: "vetd-source-attr",
		visitor: {
			JSXOpeningElement(path, state) {
				const filename = state.filename ? state.filename.replaceAll("\\", "/") : null;
				if (!filename || !filename.startsWith(designRootPosix)) return;
				const loc = path.node.loc;
				if (!loc) return;
				const already = path.node.attributes.some(
					(attr) => t.isJSXAttribute(attr) && attr.name.name === "data-vetd-source",
				);
				if (already) return;
				const rel = relative(designRoot, state.filename).replaceAll("\\", "/");
				path.node.attributes.push(
					t.jsxAttribute(t.jsxIdentifier("data-vetd-source"), t.stringLiteral(`${rel}:${loc.start.line}`)),
				);
			},
		},
	};
}

/** Inject the design dir as a Tailwind `@source` so utility classes in frames are detected. */
function vetdThemeSource() {
	return {
		name: "vetd-theme-source",
		enforce: "pre",
		transform(code, id) {
			if (!id.replaceAll("\\", "/").endsWith("src/styles.css")) return null;
			return code.replace("/*__VETD_SOURCE__*/", `@source "${designRootPosix}";`);
		},
	};
}

export default defineConfig(({ command }) => ({
	plugins: [
		react(command === "serve" ? { babel: { plugins: [vetdSourceAttr] } } : {}),
		vetdThemeSource(),
		tailwindcss(),
	],
	resolve: {
		// Design sources live OUTSIDE the engine root, so node resolution from a
		// frame file would never reach engine/node_modules — pin react to it.
		alias: {
			"@design": designRoot,
			react: resolve(engineRoot, "node_modules/react"),
			"react-dom": resolve(engineRoot, "node_modules/react-dom"),
		},
		dedupe: ["react", "react-dom"],
	},
	server: {
		host: "127.0.0.1",
		strictPort: true,
		cors: true,
		fs: { allow: [process.cwd(), designRoot] },
	},
	build: {
		// Single chunk so the export snapshot can inline everything into one HTML.
		rollupOptions: { output: { inlineDynamicImports: true } },
		modulePreload: { polyfill: false },
		chunkSizeWarningLimit: 4096,
	},
}));
