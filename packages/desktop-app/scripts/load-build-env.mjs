import { config } from "dotenv";
import { resolve } from "node:path";

// 让纯 node 构建脚本（build-presets / prepare-pack）也能从 .env 读取构建期变量，
// 例如 VETTA_TENANT。与 src/main/constants.ts、vite.main.config.ts 的约定对齐：
// 按 VETTA_BUILD_ENV 选择 .env.<mode>，再回退 .env。纯 Node 构建脚本与
// `vite build` 一样默认使用 production；开发启动器显式注入 development，
// 避免同一次构建的编译与暂存阶段使用两套环境。
//
// dotenv 不覆盖已存在的变量，因此优先级为：命令行内联 > .env.<mode> > .env。
// cwd 约定为 packages/desktop-app（相关构建脚本均从该目录运行）。
export function resolveBuildEnvMode(env = process.env) {
	const explicitMode = env.VETTA_BUILD_ENV?.trim();
	if (explicitMode) return explicitMode;
	return "production";
}

export function loadBuildEnv({ env = process.env, cwd = process.cwd() } = {}) {
	const mode = resolveBuildEnvMode(env);
	config({ path: resolve(cwd, `.env.${mode}`), processEnv: env, quiet: true });
	config({ path: resolve(cwd, ".env"), processEnv: env, quiet: true });
	return mode;
}
