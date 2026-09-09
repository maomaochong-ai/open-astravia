import type { SessionExecutionMode } from "@shared/store/atoms";
import { CommandMenuView } from "@vetta/theme-ui/overlays";
import { useEffect, useRef, type JSX } from "react";
import { useCommandMenuModel } from "../hooks/useCommandMenuModel";

interface CommandMenuProps {
	/** 与 Sidebar 共用宿主那一份实现，会话打开的落点逻辑不复制第二遍。 */
	readonly onOpenSession: (
		cwd: string,
		sessionPath?: string,
		executionMode?: SessionExecutionMode,
	) => Promise<void>;
}

/**
 * Desktop 适配层：把 model 接到 theme-ui 的纯展示组件上。
 * 关闭时整棵子树卸载（AnimatePresence 在 View 内），不做隐藏保活。
 */
export function CommandMenu({ onOpenSession }: CommandMenuProps): JSX.Element {
	const model = useCommandMenuModel({ onOpenSession });
	const inputRef = useRef<HTMLInputElement | null>(null);

	// 打开后把焦点交给输入框：⌘K 唤起后的第一动作永远是打字。
	useEffect(() => {
		if (!model.open) return;
		const frame = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [model.open]);

	return (
		<CommandMenuView
			open={model.open}
			query={model.query}
			groups={model.groups}
			selectedId={model.selectedId}
			labels={model.labels}
			suppressSelectionAnimation={model.suppressSelectionAnimation}
			inputRef={inputRef}
			onQueryChange={model.onQueryChange}
			onHoverItem={model.onHoverItem}
			onActivateItem={model.onActivateItem}
			onClose={model.onClose}
		/>
	);
}
