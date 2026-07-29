import { AnimatePresence, motion } from "motion/react";
import type { JSX, RefObject } from "react";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface ConfirmDialogViewState {
	readonly cancelLabel?: string;
	readonly checkbox?: {
		readonly checked: boolean;
		readonly label: string;
	};
	readonly confirmLabel?: string;
	readonly message: string;
	readonly title: string;
	readonly variant?: "danger" | "default";
}

export interface ConfirmDialogViewLabels {
	readonly cancel: string;
	readonly confirm: string;
}

export interface ConfirmDialogViewProps {
	readonly labels: ConfirmDialogViewLabels;
	readonly onCancel: () => void;
	readonly onCheckboxCheckedChange: (checked: boolean) => void;
	readonly onConfirm: () => void;
	readonly overlayRef: RefObject<HTMLDivElement | null>;
	readonly state: ConfirmDialogViewState | null;
}

const buttonBase =
	"group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem]";

export function ConfirmDialogView({
	labels,
	onCancel,
	onCheckboxCheckedChange,
	onConfirm,
	overlayRef,
	state,
}: ConfirmDialogViewProps): JSX.Element {
	return (
		<AnimatePresence>
			{state && (
				<motion.div
					ref={overlayRef}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.15 }}
					// pointer-events-auto: Vaul/Radix modal Drawer 会把 body 设为
					// pointer-events: none；本层 portaled 到 body，不显式恢复则点击穿透，
					// 首次点按钮只会关掉下层 sheet，需再点一次才命中 dialog。
					className="pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center bg-background/70"
					onClick={(e) => {
						if (e.target === overlayRef.current) onCancel();
					}}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
						className="relative w-[360px] rounded-xl border border-border bg-popover shadow-lg"
					>
						<ThemeSurface slot="root.confirmDialog.panel" />
						<div className="relative z-10 p-5">
							<h3 className="text-[15px] font-semibold text-foreground">{state.title}</h3>
							<p className="mt-2 max-h-[45vh] overflow-auto whitespace-pre-wrap break-words text-[13px] text-muted-foreground">
								{state.message}
							</p>
							{state.checkbox && (
								<label className="mt-4 flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
									<input
										type="checkbox"
										checked={state.checkbox.checked}
										onChange={(event) => onCheckboxCheckedChange(event.currentTarget.checked)}
										className="h-3.5 w-3.5 accent-primary"
									/>
									<span>{state.checkbox.label}</span>
								</label>
							)}
							<div className="mt-5 flex justify-end gap-2">
								<button
									type="button"
									onClick={onCancel}
									className={`${buttonBase} hover:bg-muted hover:text-foreground`}
								>
									{state.cancelLabel ?? labels.cancel}
								</button>
								<button
									type="button"
									onClick={onConfirm}
									className={`${buttonBase} ${
										state.variant === "danger"
											? "bg-destructive text-white hover:bg-destructive/90"
											: "bg-primary text-primary-foreground hover:bg-primary/90"
									}`}
								>
									{state.confirmLabel ?? labels.confirm}
								</button>
							</div>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
