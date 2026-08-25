/**
 * 运行时未就绪时给模型的引导文案。
 *
 * 这些话会作为 shim 的 stderr 输出出现在 bash 工具结果里，模型据此向用户转述该做什么。
 * 所以每一条都必须点名「去哪、点什么」，而不是只报错。
 */

import { MINIMUM_AGENT_BROWSER_VERSION } from "./version.mjs";

/** @param {"binary-missing"|"version-too-old"|"config-failed"} reason */
export function setupGuidance(reason, details = {}) {
	if (reason === "binary-missing") {
		return (
			"浏览器自动化运行时（agent-browser）尚未安装，浏览器操作无法执行。" +
			"请告诉用户：打开 Vetta 侧边栏的「浏览器操作」页面，点击「安装」完成一次性安装（会下载约 90MB 的运行时；" +
			"若系统未安装 Chrome，还需要额外下载 Chrome for Testing）。装好后无需新建会话，直接重试即可。"
		);
	}
	if (reason === "version-too-old") {
		const found = details.version ? `检测到 ${details.version}` : "检测到的版本无法识别";
		return (
			`本机的 agent-browser 版本过旧（${found}，本插件需要 ${MINIMUM_AGENT_BROWSER_VERSION} 或更高），` +
			"浏览器操作无法执行。请告诉用户：打开 Vetta 侧边栏的「浏览器操作」页面点击「升级」，" +
			"插件会装一份自己锁定的版本，不会动用户已有的全局安装。升级后直接重试即可。"
		);
	}
	if (reason === "config-failed") {
		return (
			"浏览器操作的策略配置写入失败（可能是磁盘已满或目录权限问题），为避免用错的策略跑浏览器已中止本次调用。" +
			`原因：${details.error ?? "未知"}。请告诉用户检查磁盘空间与 ~/.vetta 目录权限后重试。`
		);
	}
	return "浏览器自动化运行时当前不可用。请告诉用户：打开 Vetta 侧边栏的「浏览器操作」页面查看具体原因并重试安装。";
}
