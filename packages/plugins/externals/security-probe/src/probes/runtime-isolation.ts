import type { ProbeDefinition } from "./types";
import { errorMessage, timedResult } from "./types";

function topLevelKeys(value: unknown, limit = 40): string[] {
	if (value == null || typeof value !== "object") return [];
	return Object.keys(value as object).slice(0, limit);
}

interface HostApiModule {
	hostApi?: {
		plugins?: { list?: () => Promise<unknown> };
		settings?: { getServerToken?: () => Promise<string | undefined> };
	};
}

export const runtimeIsolationProbes: ProbeDefinition[] = [
	{
		id: "runtime.same-document",
		category: "信任模型 / 运行时隔离",
		title: "插件与宿主共享同一 document",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "runtime.same-document",
					category: "信任模型 / 运行时隔离",
					title: "插件与宿主共享同一 document",
				},
				async () => {
					const body = document.body;
					const hostRoot = document.getElementById("root") ?? document.querySelector("#app");
					const canReadHostDom = Boolean(body && (hostRoot || body.childElementCount > 0));
					const canMutate = (() => {
						const marker = document.createElement("div");
						marker.dataset.securityProbe = "dom-write-test";
						marker.style.display = "none";
						document.documentElement.append(marker);
						const found = document.querySelector('[data-security-probe="dom-write-test"]');
						marker.remove();
						return Boolean(found);
					})();

					if (canReadHostDom && canMutate) {
						return {
							status: "finding",
							severity: "critical",
							summary: "插件可读写宿主 DOM（无 iframe/worker 沙箱）",
							detail:
								"ADR-0023 明确选择「可信 in-renderer」模型：插件与宿主同 document、同 React 单例。" +
								" 任意已安装插件可挂载监听器、读取输入框、注入 UI、窃取会话可见内容。" +
								" 这不是实现疏漏，而是信任模型的直接后果；不可信第三方不可上架。",
						};
					}
					return {
						status: "pass",
						severity: "info",
						summary: "未能确认共享 document（异常宿主环境）",
						detail: `hostRoot=${Boolean(hostRoot)} canMutate=${canMutate}`,
					};
				},
			),
	},
	{
		id: "runtime.window-vetta",
		category: "信任模型 / 运行时隔离",
		title: "插件可直接访问 window.vetta 宿主桥",
		findingSeverity: "critical",
		run: () =>
			timedResult(
				{
					id: "runtime.window-vetta",
					category: "信任模型 / 运行时隔离",
					title: "插件可直接访问 window.vetta 宿主桥",
				},
				async () => {
					const vetta = window.vetta;
					if (!vetta) {
						return {
							status: "pass",
							severity: "info",
							summary: "window.vetta 未暴露（意外 hardening）",
						};
					}
					const topKeys = topLevelKeys(vetta);
					const pluginKeys = topLevelKeys(vetta.plugins);
					const hasFs = typeof vetta.fs === "object" && vetta.fs != null;
					const hasSession = typeof vetta.session === "object" && vetta.session != null;
					const hasConfig = typeof vetta.config === "object" && vetta.config != null;
					const hasPluginsManage =
						typeof vetta.plugins?.list === "function" ||
						typeof vetta.plugins?.installFromPath === "function" ||
						typeof vetta.plugins?.grantPermissions === "function";

					const surfaceDetail = [
						`window.vetta top-level: ${topKeys.join(", ") || "(none)"}`,
						`plugins keys (sample): ${pluginKeys.join(", ") || "(none)"}`,
						`fs=${hasFs} session=${hasSession} config=${hasConfig} plugins.manage-like=${hasPluginsManage}`,
					].join("\n");
					try {
						await vetta.plugins.list();
						return {
							status: "finding",
							severity: "critical",
							summary: "插件脚本可直接调用宿主 Desktop API，绕过 ctx 权限门控",
							detail: surfaceDetail,
						};
					} catch (error) {
						return {
							status: "blocked",
							severity: "info",
							summary: "宿主桥可枚举，但裸调用被闭包令牌拒绝",
							detail: `${surfaceDetail}\n${errorMessage(error)}`,
						};
					}
				},
			),
	},
	{
		id: "runtime.host-api-module-bypass",
		category: "信任模型 / 运行时隔离",
		title: "可导入宿主持令牌 API 模块",
		findingSeverity: "critical",
		run: () =>
			timedResult(
				{
					id: "runtime.host-api-module-bypass",
					category: "信任模型 / 运行时隔离",
					title: "可导入宿主持令牌 API 模块",
				},
				async () => {
					const moduleUrl = performance
						.getEntriesByType("resource")
						.map((entry) => entry.name)
						.find((name) => /\/shared\/host-api\.ts(?:\?|$)/.test(name));
					if (!moduleUrl) {
						return {
							status: "skip",
							severity: "info",
							summary: "当前构建未暴露可定位的 host-api 模块 URL",
							detail: "未发现模块不等于同 renderer 已形成安全边界。",
						};
					}
					try {
						const loaded = (await import(/* @vite-ignore */ moduleUrl)) as HostApiModule;
						const list = loaded.hostApi?.plugins?.list;
						if (typeof list !== "function") {
							return {
								status: "blocked",
								severity: "info",
								summary: "模块可导入，但未暴露可调用的宿主 API",
								detail: `url=${moduleUrl}; exports=${topLevelKeys(loaded).join(", ")}`,
							};
						}
						const plugins = await list();
						return {
							status: "finding",
							severity: "critical",
							summary: "插件可导入宿主持令牌模块并绕过 window.vetta 门禁",
							detail: [
								`url=${moduleUrl}`,
								`plugins.list result=${Array.isArray(plugins) ? `${plugins.length} items` : typeof plugins}`,
								`credential getter exposed=${typeof loaded.hostApi?.settings?.getServerToken === "function"}`,
							].join("\n"),
						};
					} catch (error) {
						return {
							status: "blocked",
							severity: "info",
							summary: "宿主持令牌模块导入或调用被拒绝",
							detail: `${moduleUrl}\n${errorMessage(error)}`,
						};
					}
				},
			),
	},
	{
		id: "runtime.web-storage",
		category: "信任模型 / 运行时隔离",
		title: "可读写宿主 localStorage / sessionStorage",
		findingSeverity: "high",
		run: () =>
			timedResult(
				{
					id: "runtime.web-storage",
					category: "信任模型 / 运行时隔离",
					title: "可读写宿主 localStorage / sessionStorage",
				},
				async () => {
					const key = `__security_probe_${Date.now()}`;
					const beforeKeys = Object.keys(localStorage).length;
					localStorage.setItem(key, "probe");
					const readBack = localStorage.getItem(key);
					localStorage.removeItem(key);
					const sampleKeys = Object.keys(localStorage).slice(0, 12);
					if (readBack === "probe") {
						return {
							status: "finding",
							severity: "high",
							summary: "插件与宿主共享 origin storage，可读写主题/偏好等键",
							detail: `localStorage keys≈${beforeKeys}; sample: ${sampleKeys.join(", ") || "(empty)"}`,
						};
					}
					return {
						status: "error",
						severity: "medium",
						summary: "localStorage 读写异常",
						detail: `readBack=${String(readBack)}`,
					};
				},
			),
	},
	{
		id: "runtime.cookie-and-fetch",
		category: "信任模型 / 运行时隔离",
		title: "渲染进程原生 fetch / cookies 可见性",
		findingSeverity: "medium",
		run: () =>
			timedResult(
				{
					id: "runtime.cookie-and-fetch",
					category: "信任模型 / 运行时隔离",
					title: "渲染进程原生 fetch / cookies 可见性",
				},
				async () => {
					const cookieLen = document.cookie.length;
					let fetchWorks = false;
					let fetchDetail = "";
					try {
						const response = await fetch("https://example.com/", { method: "HEAD", mode: "no-cors" });
						fetchWorks = true;
						fetchDetail = `type=${response.type} status=${response.status}`;
					} catch (error) {
						fetchDetail = errorMessage(error);
					}
					return {
						status: "finding",
						severity: "medium",
						summary: "插件可使用浏览器原生 fetch；document.cookie 与宿主同 origin",
						detail: `cookie length=${cookieLen}; native fetch probe: ${fetchWorks ? "reachable" : "blocked"} (${fetchDetail}). 注意：network.fetch 权限只约束 ctx.network，不约束原生 fetch。`,
					};
				},
			),
	},
	{
		id: "runtime.plugin-identity",
		category: "信任模型 / 运行时隔离",
		title: "插件身份与 agentMode 可读",
		findingSeverity: "info",
		run: (probe) =>
			timedResult(
				{
					id: "runtime.plugin-identity",
					category: "信任模型 / 运行时隔离",
					title: "插件身份与 agentMode 可读",
				},
				async () => {
					const mode = probe.ctx.getAgentMode();
					return {
						status: "pass",
						severity: "info",
						summary: `id=${probe.ctx.plugin.id} version=${probe.ctx.plugin.version} agentMode=${mode}`,
						detail: "身份由宿主注入；恶意插件仍可伪造 UI 展示，但不能改 ctx.plugin.id。",
					};
				},
			),
	},
];
