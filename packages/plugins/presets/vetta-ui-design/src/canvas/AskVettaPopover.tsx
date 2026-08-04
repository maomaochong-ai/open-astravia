import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useRef, useState } from "react";

interface AskVettaPopoverProps {
	busy: boolean;
	onSend(suggestion: string): void;
	onClose(): void;
}

/**
 * In-canvas input for "让 Vetta 调整": type the adjustment, send straight to
 * Vetta. Anchored above the ask button rather than to a frame — the ask can
 * target several frames (or the whole design), so there is no single anchor.
 */
export function AskVettaPopover({ busy, onSend, onClose }: AskVettaPopoverProps) {
	const { t } = useTranslation();
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	/** True while an IME is composing — Enter then belongs to the candidate list. */
	const composingRef = useRef(false);

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	const send = (): void => {
		const suggestion = text.trim();
		if (!suggestion || busy) return;
		onSend(suggestion);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: swallow canvas gestures under the popover
		<div
			// 画布根节点是 select-none，浮层里要能正常选中/编辑文本，这里放开。
			className="absolute bottom-24 left-1/2 z-30 w-80 -translate-x-1/2 select-text rounded-xl border border-border bg-card p-2 shadow-xl"
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<textarea
				ref={textareaRef}
				value={text}
				disabled={busy}
				placeholder={t("canvas.ask.placeholder")}
				onChange={(event) => setText(event.target.value)}
				onCompositionStart={() => {
					composingRef.current = true;
				}}
				onCompositionEnd={() => {
					composingRef.current = false;
				}}
				onKeyDown={(event) => {
					if (event.key !== "Enter") return;
					// 输入法组字中的回车属于候选上屏，不是发送。isComposing 覆盖现代浏览器，
					// keyCode 229 兜住 composition 事件顺序不标准的输入法。
					if (event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current) return;
					// Shift+Enter 换行；Enter（及 ⌘/Ctrl+Enter）发送。stopPropagation
					// 是为了让换行不被画布的键盘处理吃掉。
					if (event.shiftKey) {
						event.stopPropagation();
						return;
					}
					event.preventDefault();
					send();
				}}
				className="h-20 w-full resize-none border-0 bg-transparent p-2 text-xs outline-none focus:outline-none"
			/>
			<div className="mt-1.5 flex items-center justify-end gap-1.5">
				<button
					type="button"
					onClick={onClose}
					disabled={busy}
					className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
				>
					{t("canvas.ask.cancel")}
				</button>
				<button
					type="button"
					onClick={send}
					disabled={busy || text.trim().length === 0}
					className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
				>
					{busy ? t("canvas.ask.sending") : t("canvas.ask.send")}
				</button>
			</div>
		</div>
	);
}
