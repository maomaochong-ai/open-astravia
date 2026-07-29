import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		// 被测对象是随 skill 发布的 .mjs 脚本，测试本身也用 .mjs 直接跑它们，
		// 不引入编译步骤——脚本必须在用户机器上以原样被 node 执行。
		include: ["test/**/*.test.mjs"],
		testTimeout: 30_000,
	},
});
