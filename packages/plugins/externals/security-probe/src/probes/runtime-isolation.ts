import type { ProbeDefinition } from "./types";
import { errorMessage, timedResult } from "./types";

function topLevelKeys(value: unknown, limit = 40): string[] {
	if (value == null || typeof value !== "object") return [];
	return Object.keys(value as object).slice(0, limit);
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

					return {
						status: "finding",
						severity: "critical",
						summary: "插件脚本可直接调用宿主 Desktop API，绕过 ctx 权限门控",
						detail: [
							`window.vetta top-level: ${topKeys.join(", ") || "(none)"}`,
							`plugins keys (sample): ${pluginKeys.join(", ") || "(none)"}`,
							`fs=${hasFs} session=${hasSession} config=${hasConfig} plugins.manage-like=${hasPluginsManage}`,
							"ctx.fs / ctx.network 等门控只约束 plugin-sdk 封装；同 renderer 内直接 window.vetta.* 不受 PluginPermission 约束。",
							"主进程部分通道仍有 project-root / capability session 限制，但管理面 API（list/install/grant…）可能被恶意插件直接调用。",
						].join("\n"),
					};
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
