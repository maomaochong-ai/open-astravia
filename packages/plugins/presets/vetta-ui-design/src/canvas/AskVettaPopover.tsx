import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useRef, useState } from "react";

interface AskVettaPopoverProps {
	/** Screen-space anchor (canvas-container coordinates). */
	x: number;
	y: number;
	busy: boolean;
	onSend(suggestion: string): void;
	onClose(): void;
}

/** In-canvas input for "让 Vetta 调整": type the adjustment, send straight to Vetta. */
export function AskVettaPopover({ x, y, busy, onSend, onClose }: AskVettaPopoverProps) {
	const { t } = useTranslation();
	const [text, setText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
			className="absolute z-30 w-72 rounded-xl border border-black/10 bg-white/95 p-2 shadow-xl dark:border-white/10 dark:bg-neutral-900/95"
			style={{ left: Math.max(8, x), top: Math.max(8, y) }}
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
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						send();
					}
				}}
				className="h-20 w-full resize-none rounded-lg border border-black/10 bg-transparent p-2 text-xs outline-none focus:border-indigo-500 dark:border-white/10"
			/>
			<div className="mt-1.5 flex items-center justify-end gap-1.5">
				<button
					type="button"
					onClick={onClose}
					disabled={busy}
					className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
				>
					{t("canvas.ask.cancel")}
				</button>
				<button
					type="button"
					onClick={send}
					disabled={busy || text.trim().length === 0}
					className="rounded-lg bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
				>
					{busy ? t("canvas.ask.sending") : t("canvas.ask.send")}
				</button>
			</div>
		</div>
	);
}
