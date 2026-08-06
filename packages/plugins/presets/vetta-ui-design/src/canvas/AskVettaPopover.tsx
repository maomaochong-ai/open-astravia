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
 *
 * 观感与主按钮同源（见 style.css 的 .vetd-ask-popover / .vetd-ask-send）：同一条
 * 渐变、同样的内阴影，加上指向按钮的小尖角，让它像是从按钮里长出来的。
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
			className="vetd-ask-popover absolute bottom-24 left-1/2 z-30 w-96 -translate-x-1/2 select-text p-3"
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
			{/* 输入区自带浅底、聚焦时加深：浮层里只有这一处可编辑，得让它一眼可见 */}
			<div className="rounded-xl bg-muted/40 transition-colors focus-within:bg-muted/70">
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
					className="h-24 w-full resize-none border-0 bg-transparent p-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:outline-none"
				/>
			</div>
			{/* 键位提示从 placeholder 里挪出来常驻：一开始打字 placeholder 就没了，
			    而这两个键位恰恰是打字时才用得上。 */}
			<div className="mt-2.5 flex items-center justify-between gap-3">
				<span className="truncate text-[11px] text-muted-foreground/80">{t("canvas.ask.hint")}</span>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
					>
						{t("canvas.ask.cancel")}
					</button>
					<button
						type="button"
						onClick={send}
						disabled={busy || text.trim().length === 0}
						className="vetd-ask-send px-4 py-1.5 text-xs font-semibold"
					>
						{busy ? t("canvas.ask.sending") : t("canvas.ask.send")}
					</button>
				</div>
			</div>
		</div>
	);
}
