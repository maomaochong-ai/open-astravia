import { defineConfig } from "vitest/config";

// 页面是 React 组件，测试覆盖两条线：
// - 纯逻辑（下载入口的平台 / 架构解析、手机端链接）在 node 环境下跑；
// - 页面结构相关的用例需要 DOM，文件头单独标注 jsdom。
// JSX 交给 esbuild 的 automatic runtime 处理：这里不再引入 react 插件，
// 免得 website 与仓库根的 vite 各带一份类型。
export default defineConfig({
	esbuild: { jsx: "automatic" },
	test: {
		environment: "node",
		setupFiles: ["./test/setup.ts"],
		// 页面用 renderToStaticMarkup 渲染，单页 1-3s；给足余量避免慢机器误报。
		testTimeout: 20000,
		include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
	},
});
