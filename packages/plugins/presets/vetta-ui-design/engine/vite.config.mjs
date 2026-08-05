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
 * Reload when a design source file is ADDED or REMOVED (anywhere under the
 * design dir — frames/, components/, assets/, the root files).
 *
 * Design sources live OUTSIDE the vite root, and vite watches out-of-root files
 * one at a time as they are served (`ensureWatchedFile`). A brand-new file is
 * therefore watched by nobody, and two things go stale at once:
 *
 * - src/main.tsx collects frames with `import.meta.glob`, which vite only
 *   re-evaluates when a create/delete event reaches its watcher. Without one,
 *   every freshly loaded iframe keeps getting the stale frame table
 *   ("Frame not found") until the server restarts.
 * - src/styles.css rescans the whole `@source` dir on every re-transform, but
 *   nothing asks it to re-transform: no HMR update ever names the stylesheet.
 *   The new file then renders against a stylesheet that predates it — every
 *   utility class only that file introduces is missing, which reads as a
 *   scrambled layout until the server restarts.
 *
 * Handing the directory to vite's own watcher does not help: an `add()` during
 * `configureServer` is dropped (it only takes effect once `listen()` has
 * resolved, which no plugin hook lines up with). So watch the directory
 * directly and invalidate by hand.
 *
 * Only the file SET matters here: edits keep flowing through vite's normal HMR
 * untouched, and that path already rebuilds the stylesheet.
 */
function vetdWatchDesign() {
	const mainId = `${engineRoot.replaceAll("\\", "/")}/src/main.tsx`;
	const stylesId = `${engineRoot.replaceAll("\\", "/")}/src/styles.css`;
	/**
	 * Dot-prefixed entries are skipped on purpose: `.snapshots/` is written on
	 * every canvas capture, and reloading on it would loop capture ↔ reload.
	 */
	const listSources = (dir, prefix, out) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) listSources(`${dir}/${entry.name}`, rel, out);
			else out.push(rel);
		}
		return out;
	};
	const snapshot = () => {
		try {
			return listSources(designRoot, "", []).sort().join("\n");
		} catch {
			return "";
		}
	};
	const framesOf = (list) =>
		list
			.split("\n")
			.filter((rel) => rel.startsWith("frames/") && rel.endsWith(".tsx"))
			.join("\n");
	return {
		name: "vetd-watch-design",
		apply: "serve",
		configureServer(server) {
			let known = snapshot();
			let timer = null;
			let watcher;
			try {
				watcher = watch(designRoot, { recursive: true }, (_event, filename) => {
					// Skip the noisy dirs before touching the disk (see listSources).
					if (filename && filename.replaceAll("\\", "/").split("/").some((seg) => seg.startsWith("."))) return;
					// fs.watch fires several times per write; settle first, then diff.
					if (timer) clearTimeout(timer);
					timer = setTimeout(() => {
						timer = null;
						const next = snapshot();
						if (next === known) return;
						const framesChanged = framesOf(next) !== framesOf(known);
						known = next;
						const environment = server.environments.client;
						if (framesChanged) {
							const mod = environment.moduleGraph.getModuleById(mainId);
							if (mod) environment.moduleGraph.invalidateModule(mod);
						}
						// ?direct / ?inline variants each get their own module node.
						for (const cssMod of environment.moduleGraph.getModulesByFile(stylesId) ?? []) {
							environment.moduleGraph.invalidateModule(cssMod);
						}
						environment.hot.send({ type: "full-reload", path: "*" });
					}, 60);
				});
			} catch {
				return; // no design dir yet: it was just scaffolded, the server restarts with it
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
		vetdWatchDesign(),
		tailwindcss(),
	],
	resolve: {
		// Design sources live OUTSIDE the engine root, so node resolution from a
		// frame file would never reach engine/node_modules — pin react to it.
		alias: {
			"@design": designRoot,
			react: resolve(engineRoot, "node_modules/react"),
			"react-dom": resolve(engineRoot, "node_modules/react-dom"),
			// frame 源码里的 <Link to="..."> 会 import "react-router"，同样解析不到
			// 引擎的 node_modules；不钉住的话每个 frame 一加链接就编译失败。
			"react-router": resolve(engineRoot, "node_modules/react-router"),
		},
		dedupe: ["react", "react-dom", "react-router"],
	},
	server: {
		host: "127.0.0.1",
		strictPort: true,
		cors: true,
		// vite 自带的错误 overlay 会把整个 frame 糊成一张红色报错页——每个 frame 都是
		// 一个 iframe，画布上看到的就是设计稿整片消失。错误改由 src/bridge.ts 上报给
		// 画布：那边继续显示上一张位图，只在标题栏挂一个「构建失败」徽标。
		hmr: { overlay: false },
		fs: { allow: [process.cwd(), designRoot] },
	},
	build: {
		// Single chunk so the export snapshot can inline everything into one HTML.
		rollupOptions: { output: { inlineDynamicImports: true } },
		modulePreload: { polyfill: false },
		chunkSizeWarningLimit: 4096,
	},
}));
