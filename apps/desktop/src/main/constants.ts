import { config } from "dotenv";
import { isCloudBuildEnabled } from "../shared/feature-flags.js";

// 仅在源码模式（bun run start，tsx 直跑 src/main/main.ts）下生效：
// 通过 dotenv 加载本地 .env 文件，让源码运行也能拿到 VETTA_SERVER_URL。
// 构建产物（dist/main/index.js）里，process.env.VETTA_SERVER_URL 已被 vite define
// 在构建期替换为字面量字符串，下面的 dotenv 调用对其无影响。
// dotenv 不会覆盖已存在的变量，先加载的优先级更高。
config({ path: ".env.development", quiet: true });
config({ path: ".env", quiet: true });

// lite 构建（VETTA_CLOUD_ENABLED=false）不含云服务：登录、网关、官方市场与
// 远程模型目录全部不进产物，SERVER_URL 没有实际消费方，因此不作要求。
// 完全体构建缺了它会在运行期一路失败到「Unknown provider」，必须尽早拦住。
if (isCloudBuildEnabled() && !process.env.VETTA_SERVER_URL) {
	throw new Error("VETTA_SERVER_URL 未配置。请检查 .env.<mode> 文件，或在打包时通过 VETTA_BUILD_ENV 指定构建模式。");
}

export const DEFAULT_SERVER_URL: string = process.env.VETTA_SERVER_URL ?? "";

export const DEFAULT_SITE_URL: string = process.env.VETTA_SITE_URL || deriveSiteUrl(DEFAULT_SERVER_URL);

function deriveSiteUrl(serverUrl: string): string {
	try {
		const url = new URL(serverUrl);
		if (url.port === "8080") url.port = "3000";
		if (url.hostname.startsWith("api.")) url.hostname = url.hostname.slice(4);
		return url.origin;
	} catch {
		return serverUrl.replace(":8080", ":3000");
	}
}
