/**
 * 画布浮层的共用外壳与输入框。备注（放置草稿、thread 回复）与元素级追问共用同一
 * 套长相与键盘行为——两个入口若各写一份，IME 这类坑就得各踩一次。
 */

import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useRef, useState } from "react";

/** 浮层按它反向缩放，保持恒定视觉大小（与 frame 标题栏、整理工具条同一套办法）。 */
export const INVERSE_SCALE = "var(--vetd-lscale, 1)";

export function stopAll(event: ReactPointerEvent): void {
	event.stopPropagation();
}

/** 世界坐标定位、反向缩放的浮层外壳。 */
export function NotePanel({ x, y, children }: { x: number; y: number; children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: swallow canvas gestures under the panel
		<div
			className="vetd-note-enter vetd-note-surface pointer-events-auto absolute z-40"
			style={{ left: x, top: y, transform: `scale(${INVERSE_SCALE})`, transformOrigin: "left top" }}
			onPointerDown={stopAll}
			onPointerMove={stopAll}
			onPointerUp={stopAll}
			onKeyDown={(event) => event.stopPropagation()}
			onKeyUp={(event) => event.stopPropagation()}
		>
			<div className="w-[17rem] overflow-hidden rounded-2xl border border-border/70 bg-popover/95 shadow-xl ring-1 ring-black/5 backdrop-blur-xl">
				{children}
			</div>
		</div>
	);
}

export function NoteComposer({
	placeholder,
	submitLabel,
	onSubmit,
	onCancel,
}: {
	placeholder: string;
	submitLabel: string;
	onSubmit(text: string): void;
	onCancel(): void;
}) {
	const [text, setText] = useState("");
	/**
	 * 输入法组合中。中文/日文输入时 Enter 是「选中候选词」、Esc 是「取消这次组合」，
	 * 都不该走到提交/关闭——否则打「badge」还没选词就把半成品发出去了。
	 *
	 * 两道判断都要：`isComposing` 是标准信号，但 compositionend 与随后那次 keydown
	 * 的先后顺序各引擎不一致（确认候选词的那一下就落在这个缝里），所以再用
	 * compositionend 之后的一小段时间兜底。
	 */
	const composingRef = useRef(false);
	const composedAtRef = useRef(0);

	const submit = (event?: FormEvent): void => {
		event?.preventDefault();
		const trimmed = text.trim();
		// 空内容不落盘：直接当取消。
		if (!trimmed) {
			onCancel();
			return;
		}
		onSubmit(trimmed);
		setText("");
	};

	const isComposing = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean =>
		composingRef.current || event.nativeEvent.isComposing || Date.now() - composedAtRef.current < 80;

	const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
		if (isComposing(event)) return;
		if (event.key === "Escape") {
			event.preventDefault();
			onCancel();
			return;
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<form onSubmit={submit} className="rounded-xl bg-muted/40 p-1.5 ring-1 ring-border/50">
			<textarea
				// biome-ignore lint/a11y/noAutofocus: 放置备注的下一步就是打字，焦点必须直达
				autoFocus
				value={text}
				onChange={(event) => setText(event.target.value)}
				onKeyDown={onKeyDown}
				onCompositionStart={() => {
					composingRef.current = true;
				}}
				onCompositionEnd={() => {
					composingRef.current = false;
					composedAtRef.current = Date.now();
				}}
				placeholder={placeholder}
				rows={2}
				className="w-full resize-none bg-transparent px-1 py-0.5 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
			/>
			<div className="flex items-center justify-end gap-1.5 pt-0.5">
				<button
					type="submit"
					disabled={text.trim().length === 0}
					className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
				>
					{submitLabel}
				</button>
			</div>
		</form>
	);
}
