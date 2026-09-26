import { defineConfig } from "vite";

// 星轨官网：纯 TypeScript 静态站。
// 构建产物输出到 website/dist（仓库根 .gitignore 已忽略 dist/）。
export default defineConfig({
	// 相对资源路径：产物可直接放在任意子路径或本地 file:// 打开
	base: "./",
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: "index.html",
				download: "download.html",
			},
			output: {
				// 下载页输出到 download/index.html 实现 /download 路由
				assetFileNames: (assetInfo) => {
					if (assetInfo.name === "download.html") {
						return "download/index.html";
					}
					return "[name][extname]";
				},
			},
		},
	},
	preview: {
		port: 4173,
	},
});
