import { useEffect, useState } from "react";

/**
 * 订阅工作区的 git 状态。
 *
 * - 初始加载一次；
 * - 监听 `astravia:fs:dir-changed` 事件，收到任意目录变更后延迟刷新（节流 500ms），
 *   避免短时间内大量文件变动引发重复 IPC；
 * - rootDir 变化或组件卸载时清理。
 *
 * 返回 `Map<相对路径, 两字符状态码>`（如 `" M"`、`"??"`）。非 git 仓库时为空 Map。
 */
export function useGitStatus(rootDir: string | null): Map<string, string> {
	const [status, setStatus] = useState<Map<string, string>>(() => new Map());

	useEffect(() => {
		if (!rootDir) {
			setStatus(new Map());
			return;
		}

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const refresh = async (): Promise<void> => {
			try {
				const result = await window.astravia.fs.gitStatus(rootDir);
				if (cancelled) return;
				const next = new Map<string, string>();
				for (const [path, code] of Object.entries(result)) next.set(path, code);
				setStatus(next);
			} catch {
				// 获取失败时保持上一次状态，不抛错。
			}
		};

		void refresh();

		const scheduleRefresh = (): void => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				void refresh();
			}, 500);
		};

		const unsub = window.astravia.fs.onDirChanged(() => {
			scheduleRefresh();
		});

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
			unsub();
		};
	}, [rootDir]);

	return status;
}

/**
 * 把 git 两字符状态码映射为文件树装饰色。
 * 未跟踪/新增 → success（绿），修改/重命名 → warning（琥珀），删除 → error（红）。
 */
export function gitStatusColor(code: string): "success" | "warning" | "error" | null {
	if (code === "??" || code.includes("A")) return "success";
	if (code.includes("D")) return "error";
	if (code.includes("M") || code.includes("R") || code.includes("C")) return "warning";
	return null;
}
