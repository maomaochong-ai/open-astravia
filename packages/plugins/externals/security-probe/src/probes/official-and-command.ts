import type { ProbeDefinition } from "./types";
import { errorMessage, isPermissionDenied, timedResult } from "./types";

export const officialAndCommandProbes: ProbeDefinition[] = [
	{
		id: "official.gateway-undefined",
		category: "Official / 命令",
		title: "非 official 插件 gateway 应为 undefined",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "official.gateway-undefined",
					category: "Official / 命令",
					title: "非 official 插件 gateway 应为 undefined",
				},
				async () => {
					if (probe.ctx.gateway == null) {
						return {
							status: "blocked",
							severity: "info",
							summary: "gateway 未注入（符合 ADR-0056 第三方边界）",
						};
					}
					return {
						status: "finding",
						severity: "critical",
						summary: "非 system/official 插件拿到了 gateway API",
						detail: `typeof gateway.request = ${typeof probe.ctx.gateway.request}`,
					};
				},
			),
	},
	{
		id: "official.models-denied",
		category: "Official / 命令",
		title: "ctx.official 敏感 API 对 external 应拒绝",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "official.models-denied",
					category: "Official / 命令",
					title: "ctx.official 敏感 API 对 external 应拒绝",
				},
				async () => {
					const outcomes: string[] = [];
					let anyAllowed = false;
					const checks: Array<{ name: string; run: () => Promise<unknown> | unknown }> = [
						{
							name: "official.models.list",
							run: () => probe.ctx.official.models.list(),
						},
						{
							name: "official.general.getSettings",
							run: () => probe.ctx.official.general.getSettings(),
						},
						{
							name: "official.plugins.list",
							run: () => probe.ctx.official.plugins.list(),
						},
						{
							name: "official.navigation.help",
							run: () => probe.ctx.official.navigation.help(),
						},
						{
							name: "official.appearance.get",
							run: () => probe.ctx.official.appearance.get(),
						},
					];
					for (const check of checks) {
						try {
							const value = await Promise.resolve(check.run());
							anyAllowed = true;
							outcomes.push(`${check.name} => ALLOWED ${JSON.stringify(value).slice(0, 120)}`);
						} catch (error) {
							outcomes.push(`${check.name} => DENIED ${errorMessage(error)}`);
						}
					}
					if (anyAllowed) {
						return {
							status: "finding",
							severity: "critical",
							summary: "external 插件可调用部分 official API",
							detail: outcomes.join("\n"),
						};
					}
					return {
						status: "blocked",
						severity: "info",
						summary: "抽样 official API 均被拒绝",
						detail: outcomes.join("\n"),
					};
				},
			),
	},
	{
		id: "command.undeclared",
		category: "Official / 命令",
		title: "未声明二进制 command.run 应拒绝",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "command.undeclared",
					category: "Official / 命令",
					title: "未声明二进制 command.run 应拒绝",
				},
				async () => {
					if (!probe.ctx.permissions.has("agent.command.run")) {
						return { status: "skip", severity: "info", summary: "需要 agent.command.run" };
					}
					try {
						await probe.ctx.command.run("curl", ["https://example.com"]);
						return {
							status: "finding",
							severity: "critical",
							summary: "未声明的 curl 命令执行成功",
						};
					} catch (error) {
						const message = errorMessage(error);
						if (/not declared|permission denied|disabled/i.test(message)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "未声明命令被拒绝",
								detail: message,
							};
						}
						return {
							status: "blocked",
							severity: "info",
							summary: "未声明命令调用失败",
							detail: message,
						};
					}
				},
			),
	},
	{
		id: "command.declared-node",
		category: "Official / 命令",
		title: "已声明 node --version（需权限+用户启用）",
		findingSeverity: "medium",
		run: (probe) =>
			timedResult(
				{
					id: "command.declared-node",
					category: "Official / 命令",
					title: "已声明 node --version（需权限+用户启用）",
				},
				async () => {
					if (!probe.ctx.permissions.has("agent.command.run")) {
						return { status: "skip", severity: "info", summary: "需要 agent.command.run" };
					}
					try {
						const result = await probe.ctx.command.run("node", ["--version"], { timeoutMs: 10_000 });
						return {
							status: "pass",
							severity: "info",
							summary: `node 执行成功 exit=${result.exitCode}`,
							detail: `stdout=${result.stdout.trim()} stderr=${result.stderr.trim()}`,
						};
					} catch (error) {
						const message = errorMessage(error);
						if (isPermissionDenied(error) || /disabled|not declared/i.test(message)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "声明命令被权限/开关拦截",
								detail: message,
							};
						}
						return {
							status: "error",
							severity: "low",
							summary: "node 执行失败（环境）",
							detail: message,
						};
					}
				},
			),
	},
	{
		id: "command.declared-node-filesystem",
		category: "Official / 命令",
		title: "已授权 Node 命令可否读取系统文件",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "command.declared-node-filesystem",
					category: "Official / 命令",
					title: "已授权 Node 命令可否读取系统文件",
				},
				async () => {
					if (!probe.ctx.permissions.has("agent.command.run")) {
						return { status: "skip", severity: "info", summary: "需要 agent.command.run" };
					}
					const script =
						'const fs=require("node:fs");const p=process.platform==="win32"?"C:/Windows/win.ini":"/etc/hosts";process.stdout.write(fs.readFileSync(p,"utf8").slice(0,80))';
					try {
						const result = await probe.ctx.command.run("node", ["-e", script], { timeoutMs: 10_000 });
						if (result.exitCode === 0 && result.stdout.length > 0) {
							return {
								status: "finding",
								severity: "critical",
								summary: "agent.command.run 可绕过 ctx.fs 边界读取系统文件",
								detail: `stdout preview=${result.stdout.replace(/\s+/g, " ").slice(0, 80)}`,
							};
						}
						return {
							status: "blocked",
							severity: "info",
							summary: "系统文件读取未成功",
							detail: `exit=${result.exitCode}; stderr=${result.stderr.slice(0, 160)}`,
						};
					} catch (error) {
						const message = errorMessage(error);
						if (isPermissionDenied(error) || /disabled|not declared/i.test(message)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "Node 命令被权限/开关拦截",
								detail: message,
							};
						}
						return {
							status: "error",
							severity: "low",
							summary: "系统文件读取探测执行失败",
							detail: message,
						};
					}
				},
			),
	},
	{
		id: "host.plugins-manage-surface",
		category: "Official / 命令",
		title: "直接调用 window.vetta.plugins 管理面",
		findingSeverity: "critical",
		run: () =>
			timedResult(
				{
					id: "host.plugins-manage-surface",
					category: "Official / 命令",
					title: "直接调用 window.vetta.plugins 管理面",
				},
				async () => {
					const plugins = window.vetta?.plugins;
					if (!plugins || typeof plugins.list !== "function") {
						return {
							status: "pass",
							severity: "info",
							summary: "plugins.list 不可用",
						};
					}
					try {
						const list = await plugins.list();
						const count = Array.isArray(list) ? list.length : -1;
						const ids = Array.isArray(list)
							? list
									.slice(0, 12)
									.map((item) => {
										if (item && typeof item === "object" && "id" in item) {
											return String((item as { id: unknown }).id);
										}
										return "?";
									})
									.join(", ")
							: String(list).slice(0, 120);
						return {
							status: "finding",
							severity: "critical",
							summary: "插件可直接 list 全部已装插件（管理面未与 plugin-sdk 隔离）",
							detail: `count=${count}; sample ids: ${ids}`,
						};
					} catch (error) {
						return {
							status: "blocked",
							severity: "info",
							summary: "plugins.list 被拒绝",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
];
