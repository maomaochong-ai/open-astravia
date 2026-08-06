import type { JSX, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@vetta/ui";

export const MESSAGE_CENTER_DIALOG_SPRING = {
	type: "spring" as const,
	stiffness: 420,
	damping: 32,
};

export interface MessageCenterDialogViewProps {
	readonly open: boolean;
	readonly title: string;
	readonly onClose: () => void;
	readonly onOpenChange: (open: boolean) => void;
	readonly tabs: ReactNode;
	readonly content: ReactNode;
}

export function MessageCenterDialogView({
	open,
	title,
	onClose,
	onOpenChange,
	tabs,
	content,
}: MessageCenterDialogViewProps): JSX.Element {
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<AnimatePresence>
				{open && (
					<DialogPrimitive.Portal forceMount>
						<DialogPrimitive.Overlay asChild forceMount>
							<motion.div
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.18 }}
								className="no-drag fixed inset-0 z-50 bg-background/10 supports-backdrop-filter:backdrop-blur-[1px]"
							/>
						</DialogPrimitive.Overlay>

						<DialogPrimitive.Content
							asChild
							forceMount
							aria-describedby={undefined}
							onOpenAutoFocus={(event: Event) => event.preventDefault()}
						>
							<motion.div
								initial={{ opacity: 0, scale: 0.95, y: -10 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.96, y: -8, transition: { duration: 0.14 } }}
								transition={MESSAGE_CENTER_DIALOG_SPRING}
								style={{ transformOrigin: "top right" }}
								className="no-drag fixed right-3 top-12 z-50 flex max-h-[min(560px,calc(100vh-5rem))] w-[420px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-lg outline-none"
							>
								<div className="relative flex items-center justify-between px-5 pt-4 pb-3">
									<div className="flex items-center gap-2">
										<span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15">
											<span className="icon-[solar--bell-linear] h-3.5 w-3.5 text-primary" />
										</span>
										<DialogPrimitive.Title className="text-[14px] font-semibold text-foreground">
											{title}
										</DialogPrimitive.Title>
									</div>
									<Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
										<span className="icon-[solar--close-circle-linear] h-4 w-4" />
									</Button>
								</div>

								{tabs}
								{content}
							</motion.div>
						</DialogPrimitive.Content>
					</DialogPrimitive.Portal>
				)}
			</AnimatePresence>
		</DialogPrimitive.Root>
	);
}
