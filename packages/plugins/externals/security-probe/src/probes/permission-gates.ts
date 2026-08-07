import type { PluginPermission } from "@vetta-org/plugin-sdk";
import type { ProbeDefinition } from "./types";
import { errorMessage, isPermissionDenied, timedResult } from "./types";

const SENSITIVE_PERMISSIONS: PluginPermission[] = [
	"fs.read",
	"fs.write",
	"storage.read",
	"storage.write",
	"network.fetch",
	"agent.session.read",
	"agent.session.write",
	"agent.command.run",
	"workspace.read",
	"shell.openExternal",
];

export const permissionGateProbes: ProbeDefinition[] = [
	{
		id: "perm.matrix",
		category: "权限门控",
		title: "当前已授权权限矩阵",
		findingSeverity: "info",
		run: (probe) =>
			timedResult(
				{
					id: "perm.matrix",
					category: "权限门控",
					title: "当前已授权权限矩阵",
				},
				async () => {
					const rows = SENSITIVE_PERMISSIONS.map((permission) => {
						const granted = probe.ctx.permissions.has(permission);
						return `${granted ? "[+]" : "[-]"} ${permission}`;
					});
					const grantedCount = SENSITIVE_PERMISSIONS.filter((p) => probe.ctx.permissions.has(p)).length;
					return {
						status: "pass",
						severity: "info",
						summary: `${grantedCount}/${SENSITIVE_PERMISSIONS.length} 敏感权限已授权`,
						detail: rows.join("\n"),
					};
				},
			),
	},
	{
		id: "perm.require-unknown",
		category: "权限门控",
		title: "require() 对未授权权限抛错",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "perm.require-unknown",
					category: "权限门控",
					title: "require() 对未授权权限抛错",
				},
				async () => {
					// Pick a permission that is rarely granted for this external probe unless user fully trusts it.
					const candidate: PluginPermission = "ai.complete";
					if (probe.ctx.permissions.has(candidate)) {
						return {
							status: "skip",
							severity: "info",
							summary: `${candidate} 已授权，无法验证 deny 路径`,
							detail: "在设置中撤销 ai.complete 后重跑。",
						};
					}
					try {
						probe.ctx.permissions.require(candidate);
						return {
							status: "finding",
							severity: "high",
							summary: "require() 未对未授权权限抛错",
							detail: candidate,
						};
					} catch (error) {
						if (isPermissionDenied(error)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "未授权 require() 正确抛出 permission denied",
								detail: errorMessage(error),
							};
						}
						return {
							status: "error",
							severity: "medium",
							summary: "require() 抛出非权限错误",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "perm.fs-read-gate",
		category: "权限门控",
		title: "fs.read 未授权时 readFile 应拒绝",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "perm.fs-read-gate",
					category: "权限门控",
					title: "fs.read 未授权时 readFile 应拒绝",
				},
				async () => {
					if (probe.ctx.permissions.has("fs.read")) {
						return {
							status: "skip",
							severity: "info",
							summary: "fs.read 已授权，跳过 deny 探测",
							detail: "撤销 fs.read 后可验证 renderer 门控。",
						};
					}
					const target = probe.projectRoot ?? "/etc/hosts";
					try {
						await probe.ctx.fs.readFile(target);
						return {
							status: "finding",
							severity: "high",
							summary: "无 fs.read 仍可读文件",
							detail: target,
						};
					} catch (error) {
						if (isPermissionDenied(error)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "无 fs.read 时 ctx.fs.readFile 被拒绝",
								detail: errorMessage(error),
							};
						}
						return {
							status: "pass",
							severity: "info",
							summary: "调用失败（非权限文案，可能是路径/主进程校验）",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "perm.network-gate",
		category: "权限门控",
		title: "network.fetch 未授权时 request 应拒绝",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "perm.network-gate",
					category: "权限门控",
					title: "network.fetch 未授权时 request 应拒绝",
				},
				async () => {
					if (probe.ctx.permissions.has("network.fetch")) {
						return {
							status: "skip",
							severity: "info",
							summary: "network.fetch 已授权，跳过 deny 探测",
						};
					}
					try {
						await probe.ctx.network.request({
							url: "https://example.com/",
							method: "GET",
							responseType: "text",
							timeoutMs: 5_000,
						});
						return {
							status: "finding",
							severity: "high",
							summary: "无 network.fetch 仍可经 ctx.network 发请求",
						};
					} catch (error) {
						if (isPermissionDenied(error)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "无 network.fetch 时 ctx.network 被拒绝",
								detail: errorMessage(error),
							};
						}
						return {
							status: "pass",
							severity: "info",
							summary: "调用失败",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "perm.storage-gate",
		category: "权限门控",
		title: "storage.write 未授权时 writeJson 应拒绝",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "perm.storage-gate",
					category: "权限门控",
					title: "storage.write 未授权时 writeJson 应拒绝",
				},
				async () => {
					if (probe.ctx.permissions.has("storage.write")) {
						return {
							status: "skip",
							severity: "info",
							summary: "storage.write 已授权，跳过 deny 探测",
						};
					}
					try {
						await probe.ctx.storage.writeJson("probe-should-fail.json", { ok: false });
						return {
							status: "finding",
							severity: "high",
							summary: "无 storage.write 仍可写插件存储",
						};
					} catch (error) {
						if (isPermissionDenied(error)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "无 storage.write 时 writeJson 被拒绝",
								detail: errorMessage(error),
							};
						}
						return {
							status: "pass",
							severity: "info",
							summary: "调用失败",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
	{
		id: "perm.session-write-gate",
		category: "权限门控",
		title: "agent.session.write 未授权时 insertText 应拒绝",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "perm.session-write-gate",
					category: "权限门控",
					title: "agent.session.write 未授权时 insertText 应拒绝",
				},
				async () => {
					if (probe.ctx.permissions.has("agent.session.write")) {
						return {
							status: "skip",
							severity: "info",
							summary: "agent.session.write 已授权，跳过 deny 探测（避免污染输入框）",
						};
					}
					try {
						probe.ctx.conversation.insertText("[security-probe should not appear]");
						return {
							status: "finding",
							severity: "high",
							summary: "无 agent.session.write 仍可 insertText",
						};
					} catch (error) {
						if (isPermissionDenied(error)) {
							return {
								status: "blocked",
								severity: "info",
								summary: "无 session.write 时 insertText 被拒绝",
								detail: errorMessage(error),
							};
						}
						return {
							status: "pass",
							severity: "info",
							summary: "调用失败",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
];
