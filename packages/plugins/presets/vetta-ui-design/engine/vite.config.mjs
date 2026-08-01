// Vetta Design Engine — shared vite template (materialized to ~/.vetta/design-engine/<version>/).
// The design source dir (x.vetd.d/) is mounted via the VETD_SRC env var; the engine itself
// never contains user content. See ADR-0053.
import { readdirSync, watch } from "node:fs";
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

/**
 * Reload when a frame file is ADDED or REMOVED.
 *
 * src/main.tsx collects frames with `import.meta.glob`, which vite only
 * re-evaluates when a create/delete event reaches its watcher. Design sources
 * live outside the vite root, and vite watches out-of-root files one at a time
 * as they are served (`ensureWatchedFile`) — a brand-new frame file is watched
 * by nobody, so the glob importer is never invalidated and every freshly loaded
 * iframe keeps getting the stale frame table ("Frame not found") until the
 * server restarts. Handing the directory to vite's own watcher does not help:
 * an `add()` during `configureServer` is dropped (it only takes effect once
 * `listen()` has resolved, which no plugin hook lines up with).
 *
 * So watch the directory directly and invalidate by hand. Only the frame SET
 * matters here: edits keep flowing through vite's normal HMR untouched.
 */
function vetdWatchFrames() {
	const framesDir = `${designRootPosix}/frames`;
	const mainId = `${engineRoot.replaceAll("\\", "/")}/src/main.tsx`;
	const listFrames = () => {
		try {
			return readdirSync(framesDir)
				.filter((name) => name.endsWith(".tsx"))
				.sort()
				.join("\n");
		} catch {
			return "";
		}
	};
	return {
		name: "vetd-watch-frames",
		apply: "serve",
		configureServer(server) {
			let known = listFrames();
			let timer = null;
			let watcher;
			try {
				watcher = watch(framesDir, () => {
					// fs.watch fires several times per write; settle first, then diff.
					if (timer) clearTimeout(timer);
					timer = setTimeout(() => {
						timer = null;
						const next = listFrames();
						if (next === known) return;
						known = next;
						const environment = server.environments.client;
						const mod = environment.moduleGraph.getModuleById(mainId);
						if (mod) environment.moduleGraph.invalidateModule(mod);
						environment.hot.send({ type: "full-reload", path: "*" });
					}, 60);
				});
			} catch {
				return; // no frames dir yet: the design was just scaffolded, server restarts with it
			}
			server.httpServer?.once("close", () => {
				if (timer) clearTimeout(timer);
				watcher.close();
			});
		},
	};
}

export default defineConfig(({ command }) => ({
	plugins: [
		react(command === "serve" ? { babel: { plugins: [vetdSourceAttr] } } : {}),
		vetdThemeSource(),
		vetdWatchFrames(),
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
