import { AnimatePresence, motion } from "motion/react";
import type { JSX, RefObject } from "react";
import { cn, OVERLAY_BACKDROP_CLASS, PANEL_SHADOW_CLASS } from "@astravia-org/ui/utils";
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

// 与全局 Dialog 的按钮同尺寸；取消用透明底，确认用主色 / 危险色。
const buttonBase =
	"group/button inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding px-4 text-[13px] font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50";

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
					className={cn("pointer-events-auto fixed inset-0 z-[100] flex items-center justify-center", OVERLAY_BACKDROP_CLASS)}
					onClick={(e) => {
						if (e.target === overlayRef.current) onCancel();
					}}
				>
					<motion.div
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
						// 与全局 Dialog 同一套：无外边框、柔和投影、通栏底栏。overflow-hidden 让底栏跟随圆角。
						className={cn(
							"relative w-[min(400px,calc(100vw-32px))] overflow-hidden rounded-2xl bg-popover",
							PANEL_SHADOW_CLASS,
						)}
					>
						<ThemeSurface slot="root.confirmDialog.panel" />
						<div className="relative z-10">
							<div className="p-6">
								<h3 className="text-[17px] leading-snug font-semibold tracking-tight text-foreground">{state.title}</h3>
								<p className="mt-2 max-h-[45vh] overflow-auto text-[13px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
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
							</div>
							<div className="flex justify-end gap-2 border-t border-border/50 bg-muted/40 px-6 py-4">
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
