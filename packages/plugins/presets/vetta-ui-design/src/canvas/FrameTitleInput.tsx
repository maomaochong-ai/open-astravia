import { useEffect, useRef, useState } from "react";

interface FrameTitleInputProps {
	initial: string;
	onCommit(title: string): void;
	onCancel(): void;
}

/** 输入框最窄也留出这些字符宽度，空标题时不至于缩成一条缝。 */
const MIN_CH = 6;

/**
 * Frame 标题的就地编辑框，替换标题栏里的文字按钮。挂载即全选（Figma 行为：
 * 重命名通常是整个换掉），Enter / 失焦提交，Esc 取消。
 */
export function FrameTitleInput({ initial, onCommit, onCancel }: FrameTitleInputProps) {
	const [value, setValue] = useState(initial);
	const inputRef = useRef<HTMLInputElement | null>(null);
	/** 已经提交/取消过，别让随后的 blur 再提交一次。 */
	const settledRef = useRef(false);
	/** 输入法组字中的回车属于候选上屏，不是提交。 */
	const composingRef = useRef(false);

	useEffect(() => {
		inputRef.current?.select();
	}, []);

	const settle = (commit: boolean): void => {
		if (settledRef.current) return;
		settledRef.current = true;
		if (commit) onCommit(value);
		else onCancel();
	};

	return (
		<input
			ref={inputRef}
			value={value}
			// 画布外壳是 select-none，编辑态要能正常选中文本。
			className="w-auto min-w-0 select-text rounded-sm border border-[var(--vetd-selected)] bg-card px-1 text-xs font-medium text-foreground outline-none"
			style={{ width: `${Math.max(MIN_CH, value.length + 1)}ch` }}
			onChange={(event) => setValue(event.target.value)}
			onBlur={() => settle(true)}
			// 拖动标题栏会起手移动 frame，编辑态下这些手势都不该穿出去。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
			onCompositionStart={() => {
				composingRef.current = true;
			}}
			onCompositionEnd={() => {
				composingRef.current = false;
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					settle(false);
					return;
				}
				if (event.key !== "Enter") return;
				if (event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current) return;
				event.preventDefault();
				settle(true);
			}}
		/>
	);
}
