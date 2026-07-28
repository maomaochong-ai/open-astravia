import { BotAvatar } from "@shared/components/BotAvatar";
import { ThemeSurface } from "@vetta/theme-ui/appearance";
import { Button } from "@vetta/ui";
import { AnimatePresence, motion } from "motion/react";
import type { OAuthLoginPhase } from "../hooks/useOAuthLogin";

export interface LoginDialogViewLabels {
	readonly close: string;
	readonly footerHint: string;
	readonly oauthButton: string;
	readonly reopen: string;
	readonly subtitle: string;
	readonly title: string;
	readonly waitingHint: string;
	readonly waitingTitle: string;
}

export interface LoginDialogViewProps {
	readonly error: string;
	readonly labels: LoginDialogViewLabels;
	readonly onClose: () => void;
	readonly onReopen: () => void;
	readonly onStart: () => void;
	readonly open: boolean;
	readonly phase: OAuthLoginPhase;
}

export function LoginDialogView({
	error,
	labels,
	onClose,
	onReopen,
	onStart,
	open,
	phase,
}: LoginDialogViewProps): JSX.Element {
	const waiting = phase === "waiting";

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.15 }}
					className="fixed inset-0 z-50 flex items-center justify-center"
					onClick={onClose}
				>
					<div className="absolute inset-0 bg-background/70 backdrop-blur-sm" />

					<motion.div
						initial={{ opacity: 0, scale: 0.97, y: 8 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.97, y: 8 }}
						transition={{ type: "spring", stiffness: 300, damping: 26 }}
						className="relative w-[380px] overflow-visible rounded-2xl border border-border/60 bg-card/95 shadow-lg backdrop-blur-md"
						onClick={(e) => e.stopPropagation()}
					>
						<ThemeSurface slot="root.loginDialog.panel" />
						<div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-primary/10 to-transparent" />

						<Button
							variant="ghost"
							size="icon-xs"
							onClick={onClose}
							title={labels.close}
							className="absolute right-3 top-3 z-20"
						>
							<span className="icon-[mdi--close] h-4 w-4" />
						</Button>

						<div className="relative z-10 px-6 pb-6 pt-7">
							<div className="mb-6 flex flex-col items-center text-center">
								<div className="mb-3 flex items-center justify-center">
									<BotAvatar size="md" autoplay />
								</div>
								<h2 className="text-[15px] font-semibold text-foreground">
									{waiting ? labels.waitingTitle : labels.title}
								</h2>
								<p className="mt-1 text-[12px] text-muted-foreground">
									{waiting ? labels.waitingHint : labels.subtitle}
								</p>
							</div>

							<AnimatePresence>
								{error && (
									<motion.p
										initial={{ opacity: 0, y: -4 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -4 }}
										className="mb-3 flex items-center gap-1.5 text-[12px] text-destructive"
									>
										<span className="icon-[mdi--alert-circle-outline] h-3.5 w-3.5" />
										{error}
									</motion.p>
								)}
							</AnimatePresence>

							{waiting ? (
								<Button variant="outline" className="h-10 w-full rounded-lg text-[13px]" onClick={onReopen}>
									<span className="flex items-center gap-2">
										<span className="icon-[mdi--open-in-new] h-4 w-4" />
										{labels.reopen}
									</span>
								</Button>
							) : (
								<Button className="h-10 w-full rounded-lg text-[13px]" onClick={onStart}>
									<span className="flex items-center gap-2">
										<span className="icon-[mdi--login] h-4 w-4" />
										{labels.oauthButton}
									</span>
								</Button>
							)}

							<p className="mt-5 text-center text-[11px] text-muted-foreground/60">{labels.footerHint}</p>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
