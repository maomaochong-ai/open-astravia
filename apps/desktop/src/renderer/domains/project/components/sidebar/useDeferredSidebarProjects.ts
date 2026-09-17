import { SIDEBAR_DOCK_ANIMATION_MS } from "@vetta-org/theme-ui/layout";
import { startTransition, useEffect, useState } from "react";

/**
 * 项目/会话区是否可以挂载了。
 *
 * 侧边栏首次出现时，项目/会话区（虚拟列表、每个项目行、右键菜单…）是这棵子树里最贵的
 * 一块：实测它占整次挂载约 150ms 同步渲染的一半。若它压在「点击展开」那一次同步 commit
 * 里，展开动画的头几帧会整段丢掉——观感是侧边栏一顿一顿地出来，而动画本身是平滑的。
 *
 * 所以先只挂轻量外壳，把这块排到展开动画结束之后再走 transition 补上。试过「下一帧 +
 * transition」：不够，transition 的切片仍落在动画帧上，掉帧只减一半。
 */
export function useDeferredSidebarProjects(): boolean {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const timer = window.setTimeout(() => {
			// transition 而非直接 setState：这块渲染可被打断，别再堵住随后的交互。
			startTransition(() => setReady(true));
		}, SIDEBAR_DOCK_ANIMATION_MS);
		return () => window.clearTimeout(timer);
	}, []);
	return ready;
}
