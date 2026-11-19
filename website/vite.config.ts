import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// 星轨官网：Vite + React 的客户端应用。
// 页面由 src/pages 组装、文案在 src/content，路由走 History API，
// 所以 /features、/download、/about 都是同一个 index.html 渲染出来的。
const ROOT = import.meta.dirname;

/** 应用内路由；开发与预览服务器在找不到文件时回落到 index.html。 */
export const ROUTES = ["", "features", "download", "about"] as const;

/** 客户端路由需要服务器配合：这些路径没有对应文件，一律交给 index.html。 */
function spaFallback(): Connect.NextHandleFunction {
	return (req, _res, next) => {
		const [path, query] = (req.url ?? "").split("?");
		const route = path.replace(/^\/+|\/+$/g, "");
		if (route && !route.includes(".") && (ROUTES as readonly string[]).includes(route)) {
			req.url = `/index.html${query ? `?${query}` : ""}`;
		}
		next();
	};
}

function routesPlugin(): Plugin {
	return {
		name: "astravia-routes",
		configureServer(server) {
			server.middlewares.use(spaFallback());
		},
		configurePreviewServer(server) {
			server.middlewares.use(spaFallback());
		},
	};
}

export default defineConfig({
	base: "/",
	plugins: [react(), routesPlugin()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			input: { index: `${ROOT}/index.html` },
		},
	},
	preview: { port: 4173 },
});
