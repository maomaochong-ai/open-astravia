import { useEffect } from "react";

interface ConfirmDialogProps {
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;
	/** 危险动作用红色确认按钮（删除）。 */
	danger?: boolean;
	onConfirm(): void;
	onCancel(): void;
}

/**
 * 画布内的二次确认框。刻意只覆盖画布本身而不是整个窗口——画布活在活动面板里，
 * 这里的确认与宿主其它区域无关，盖住整窗口反而挡住会话。
 */
export function ConfirmDialog({
	title,
	description,
	confirmLabel,
	cancelLabel,
	danger,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onCancel();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [onCancel]);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop over the canvas
		<div
			className="absolute inset-0 z-50 flex select-text items-center justify-center bg-black/40 px-6"
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			onClick={onCancel}
			onContextMenu={(event) => event.preventDefault()}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: keeps backdrop clicks off the panel */}
			<div
				className="w-full max-w-72 rounded-xl border border-border bg-card p-4 shadow-2xl"
				role="alertdialog"
				aria-label={title}
				onClick={(event) => event.stopPropagation()}
			>
				<p className="text-sm font-medium text-foreground">{title}</p>
				<p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
				<div className="mt-4 flex items-center justify-end gap-1.5">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
					>
						{cancelLabel}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className={`rounded-lg px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 ${
							danger ? "bg-red-500" : "bg-primary"
						}`}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
