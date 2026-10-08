import { defineConfig } from "vitest/config";

// 官网是纯静态站，只对可直接推理的逻辑（下载入口的平台 / 架构解析）做单元测试。
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
	},
});
