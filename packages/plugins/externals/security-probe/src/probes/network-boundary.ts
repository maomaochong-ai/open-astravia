import type { ProbeDefinition } from "./types";
import { errorMessage, isPermissionDenied, timedResult } from "./types";

export const networkBoundaryProbes: ProbeDefinition[] = [
	{
		id: "net.protocol-file",
		category: "网络边界",
		title: "file:// 协议应被拒绝",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "net.protocol-file",
					category: "网络边界",
					title: "file:// 协议应被拒绝",
				},
				async () => {
					if (!probe.ctx.permissions.has("network.fetch")) {
						return { status: "skip", severity: "info", summary: "需要 network.fetch" };
					}
					try {
						await probe.ctx.network.request({
							url: "file:///etc/hosts",
							method: "GET",
							responseType: "text",
							timeoutMs: 3_000,
						});
						return {
							status: "finding",
							severity: "high",
							summary: "file:// 请求未被拒绝",
						};
					} catch (error) {
						return {
							status: "blocked",
							severity: "info",
							summary: "非 http(s) 协议被拒绝",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "net.ssrf-localhost",
		category: "网络边界",
		title: "网络 host 声明应允许 localhost 并拒绝未声明地址",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "net.ssrf-localhost",
					category: "网络边界",
					title: "网络 host 声明应允许 localhost 并拒绝未声明地址",
				},
				async () => {
					if (!probe.ctx.permissions.has("network.fetch")) {
						return { status: "skip", severity: "info", summary: "需要 network.fetch" };
					}
					const declaredUrls = ["http://127.0.0.1:1/", "http://localhost:1/", "http://[::1]:1/"];
					const outcomes: string[] = [];
					let declaredHostRejected = false;
					for (const url of declaredUrls) {
						try {
							const response = await probe.ctx.network.request({
								url,
								method: "GET",
								responseType: "text",
								timeoutMs: 2_000,
							});
							outcomes.push(`${url} => policy allowed, status=${response.status} ok=${response.ok}`);
						} catch (error) {
							const message = errorMessage(error);
							if (/not declared/i.test(message)) declaredHostRejected = true;
							outcomes.push(`${url} => ${message}`);
						}
					}
					let undeclaredHostBlocked = false;
					try {
						await probe.ctx.network.request({
							url: "http://169.254.169.254/",
							method: "GET",
							responseType: "text",
							timeoutMs: 2_000,
						});
						outcomes.push("http://169.254.169.254/ => request reached undeclared host");
					} catch (error) {
						const message = errorMessage(error);
						undeclaredHostBlocked = /not declared/i.test(message);
						outcomes.push(`http://169.254.169.254/ => ${message}`);
					}
					if (declaredHostRejected || !undeclaredHostBlocked) {
						return {
							status: "finding",
							severity: "high",
							summary: "网络 host 声明策略未按预期生效",
							detail: outcomes.join("\n"),
						};
					}
					return {
						status: "pass",
						severity: "info",
						summary: "已声明 localhost 进入连接阶段，未声明地址被拒绝",
						detail: outcomes.join("\n"),
					};
				},
			),
	},
	{
		id: "net.public-https",
		category: "网络边界",
		title: "合法 https 请求（需 network.fetch）",
		findingSeverity: "info",
		run: (probe) =>
			timedResult(
				{
					id: "net.public-https",
					category: "网络边界",
					title: "合法 https 请求（需 network.fetch）",
				},
				async () => {
					if (!probe.ctx.permissions.has("network.fetch")) {
						return { status: "skip", severity: "info", summary: "需要 network.fetch" };
					}
					try {
						const response = await probe.ctx.network.request({
							url: "https://example.com/",
							method: "GET",
							responseType: "text",
							timeoutMs: 10_000,
						});
						return {
							status: "pass",
							severity: "info",
							summary: `https example.com => ${response.status}`,
							detail: `ok=${response.ok}; bodyPreview=${String(response.body).slice(0, 80)}`,
						};
					} catch (error) {
						if (isPermissionDenied(error)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "权限拒绝",
								detail: errorMessage(error),
							};
						}
						return {
							status: "error",
							severity: "low",
							summary: "外网请求失败（网络环境）",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "net.open-external-protocol",
		category: "网络边界",
		title: "openExternal 非 http(s) 应被拒绝",
		findingSeverity: "medium",
		run: (probe) =>
			timedResult(
				{
					id: "net.open-external-protocol",
					category: "网络边界",
					title: "openExternal 非 http(s) 应被拒绝",
				},
				async () => {
					if (!probe.ctx.permissions.has("shell.openExternal")) {
						return { status: "skip", severity: "info", summary: "需要 shell.openExternal" };
					}
					try {
						await probe.ctx.ui.openExternal("javascript:alert(1)");
						return {
							status: "finding",
							severity: "medium",
							summary: "javascript: URL 未被 openExternal 拒绝",
						};
					} catch (error) {
						return {
							status: "blocked",
							severity: "info",
							summary: "危险协议被拒绝",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
];
