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
		title: "主进程代发请求可达 localhost（SSRF 面）",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "net.ssrf-localhost",
					category: "网络边界",
					title: "主进程代发请求可达 localhost（SSRF 面）",
				},
				async () => {
					if (!probe.ctx.permissions.has("network.fetch")) {
						return { status: "skip", severity: "info", summary: "需要 network.fetch" };
					}
					const urls = [
						"http://127.0.0.1:1/",
						"http://localhost:1/",
						"http://[::1]:1/",
						"http://169.254.169.254/",
					];
					const outcomes: string[] = [];
					let reachedStack = false;
					for (const url of urls) {
						try {
							const response = await probe.ctx.network.request({
								url,
								method: "GET",
								responseType: "text",
								timeoutMs: 2_000,
							});
							reachedStack = true;
							outcomes.push(`${url} => status=${response.status} ok=${response.ok}`);
						} catch (error) {
							const message = errorMessage(error);
							// Connection refused still means the host attempted the request (SSRF surface exists).
							if (/ECONNREFUSED|fetch failed|network|timed out|abort/i.test(message)) {
								reachedStack = true;
							}
							outcomes.push(`${url} => ${message}`);
						}
					}
					if (reachedStack) {
						return {
							status: "finding",
							severity: "high",
							summary: "ctx.network 可对 localhost / 链路本地地址发起主进程请求",
							detail: [
								"plugin-network-service 仅限制 http/https，无 SSRF 黑名单。",
								"持有 network.fetch 的插件可探测本机服务、云 metadata（若路由可达）。",
								"",
								...outcomes,
							].join("\n"),
						};
					}
					return {
						status: "blocked",
						severity: "info",
						summary: "内网探测均被提前拦截",
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
