import type { ProbeDefinition } from "./types";
import { errorMessage, isPermissionDenied, isStorageEscape, timedResult } from "./types";

export const storageNamespaceProbes: ProbeDefinition[] = [
	{
		id: "storage.own-namespace",
		category: "存储命名空间",
		title: "本插件 storage 读写闭环",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "storage.own-namespace",
					category: "存储命名空间",
					title: "本插件 storage 读写闭环",
				},
				async () => {
					if (!probe.ctx.permissions.has("storage.write") || !probe.ctx.permissions.has("storage.read")) {
						return {
							status: "skip",
							severity: "info",
							summary: "需要 storage.read + storage.write",
						};
					}
					const key = `security-probe/${probe.probeToken}.json`;
					await probe.ctx.storage.writeJson(key, { token: probe.probeToken, at: Date.now() });
					const read = await probe.ctx.storage.readJson<{ token: string }>(key);
					const listed = await probe.ctx.storage.list("security-probe/");
					if (read?.token === probe.probeToken && listed.some((item) => item.includes(probe.probeToken))) {
						return {
							status: "pass",
							severity: "info",
							summary: "本插件命名空间读写与 list 正常",
							detail: `key=${key}; list=${listed.slice(0, 5).join(", ")}`,
						};
					}
					return {
						status: "error",
						severity: "medium",
						summary: "写入后读回不一致",
						detail: JSON.stringify({ read, listed }),
					};
				},
			),
	},
	{
		id: "storage.path-traversal",
		category: "存储命名空间",
		title: "storage 路径穿越 ../ 应被拒绝",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "storage.path-traversal",
					category: "存储命名空间",
					title: "storage 路径穿越 ../ 应被拒绝",
				},
				async () => {
					if (!probe.ctx.permissions.has("storage.write")) {
						return {
							status: "skip",
							severity: "info",
							summary: "需要 storage.write",
						};
					}
					const attempts = [
						"../other-plugin/secrets.json",
						"..\\other-plugin\\secrets.json",
						"foo/../../escape.json",
						"....//....//escape.json",
					];
					const outcomes: string[] = [];
					let leaked = false;
					for (const path of attempts) {
						try {
							await probe.ctx.storage.writeJson(path, { evil: true });
							outcomes.push(`${path} => WROTE (bad)`);
							leaked = true;
						} catch (error) {
							const ok = isStorageEscape(error) || isPermissionDenied(error);
							outcomes.push(`${path} => ${ok ? "blocked" : `error: ${errorMessage(error)}`}`);
							if (!ok) {
								// Unexpected error still means write failed — treat as blocked for safety.
							}
						}
					}
					if (leaked) {
						return {
							status: "finding",
							severity: "critical",
							summary: "storage 路径穿越写入成功，可能逃逸插件命名空间",
							detail: outcomes.join("\n"),
						};
					}
					return {
						status: "blocked",
						severity: "info",
						summary: "相对路径穿越写入均被拒绝",
						detail: outcomes.join("\n"),
					};
				},
			),
	},
	{
		id: "storage.absolute-path",
		category: "存储命名空间",
		title: "storage 绝对路径应被拒绝",
		findingSeverity: "critical",
		run: (probe) =>
			timedResult(
				{
					id: "storage.absolute-path",
					category: "存储命名空间",
					title: "storage 绝对路径应被拒绝",
				},
				async () => {
					if (!probe.ctx.permissions.has("storage.write")) {
						return {
							status: "skip",
							severity: "info",
							summary: "需要 storage.write",
						};
					}
					const attempts = [
						"C:\\Windows\\Temp\\security-probe-escape.json",
						"/tmp/security-probe-escape.json",
						"/etc/passwd",
					];
					const outcomes: string[] = [];
					let leaked = false;
					for (const path of attempts) {
						try {
							await probe.ctx.storage.writeJson(path, { evil: true });
							outcomes.push(`${path} => WROTE (bad)`);
							leaked = true;
						} catch (error) {
							outcomes.push(
								`${path} => ${isStorageEscape(error) ? "blocked" : errorMessage(error)}`,
							);
						}
					}
					if (leaked) {
						return {
							status: "finding",
							severity: "critical",
							summary: "绝对路径写入成功",
							detail: outcomes.join("\n"),
						};
					}
					return {
						status: "blocked",
						severity: "info",
						summary: "绝对路径写入被拒绝",
						detail: outcomes.join("\n"),
					};
				},
			),
	},
	{
		id: "storage.null-byte",
		category: "存储命名空间",
		title: "storage 路径含空字节应被拒绝",
		findingSeverity: "high",
		run: (probe) =>
			timedResult(
				{
					id: "storage.null-byte",
					category: "存储命名空间",
					title: "storage 路径含空字节应被拒绝",
				},
				async () => {
					if (!probe.ctx.permissions.has("storage.write")) {
						return {
							status: "skip",
							severity: "info",
							summary: "需要 storage.write",
						};
					}
					const path = `legit.json\0../../escape.json`;
					try {
						await probe.ctx.storage.writeJson(path, { evil: true });
						return {
							status: "finding",
							severity: "high",
							summary: "含空字节路径写入成功",
							detail: path,
						};
					} catch (error) {
						return {
							status: "blocked",
							severity: "info",
							summary: "空字节路径被拒绝",
							detail: errorMessage(error),
						};
					}
				},
			),
	},
];
