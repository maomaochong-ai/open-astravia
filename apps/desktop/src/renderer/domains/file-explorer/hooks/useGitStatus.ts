import { useEffect, useState } from "react";

/**
 * 订阅工作区的 git 状态。
 *
 * - 初始加载一次；
 * - 监听 `astravia:fs:dir-changed` 事件，收到任意目录变更后延迟刷新（节流 500ms），
 *   避免短时间内大量文件变动引发重复 IPC；
 * - `watchKey` 变化时也刷新。Agent 改文件时不一定会触发 dir-changed：只有被 watch 的
 *   目录（根目录与已展开目录）才会广播，改到未展开的目录、或走远端/编辑器的写入路径时
 *   事件根本不会到渲染层，文件树就一直不带 git 颜色。传一个随对话推进变化的数字即可。
 * - rootDir 变化或组件卸载时清理。
 *
 * 返回 `Map<相对路径, 两字符状态码>`（如 `" M"`、`"??"`）。非 git 仓库时为空 Map。
 */
export function useGitStatus(rootDir: string | null, watchKey?: number): Map<string, string> {
	const [status, setStatus] = useState<Map<string, string>>(() => new Map());

	useEffect(() => {
		// watchKey 是刻意的刷新信号：effect 体内不读它，但它的变化必须触发重跑。
		// 用一次显式读取把这个意图写进代码，避免被当成多余的依赖删掉。
		void watchKey;
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
	}, [rootDir, watchKey]);

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
