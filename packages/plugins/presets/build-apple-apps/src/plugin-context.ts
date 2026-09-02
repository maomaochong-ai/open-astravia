import type { PluginContext } from "@vetta-org/plugin-sdk";

/**
 * activate() 拿到的 ctx 存这里：面板组件是零 props 的，拿不到 ctx，
 * 又不能在模块顶层求值（MF 共享依赖是异步填充的）。
 */
let pluginCtx: PluginContext | null = null;

export function setPluginCtx(ctx: PluginContext): void {
	pluginCtx = ctx;
}

export function getPluginCtx(): PluginContext {
	if (!pluginCtx) throw new Error("build-apple-apps: plugin context is not ready");
	return pluginCtx;
}
