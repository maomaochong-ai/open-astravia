import { useCallback, useRef, useState, type JSX, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@vetta-org/ui";

export interface AchievementPromotionDialogViewLabels {
	readonly title: string;
	readonly stageName: string;
}

export interface AchievementPromotionDialogViewProps {
	readonly onComplete: () => void;
	readonly labels: AchievementPromotionDialogViewLabels;
	/** 3D badge + confetti stay host-provided (or theme achievements slots). */
	readonly renderBadge: (handlers: {
		onCelebrate: () => void;
		onComplete: () => void;
		onHideText: () => void;
		onRevealText: () => void;
	}) => ReactNode;
	readonly renderConfetti: (triggerToken: number) => ReactNode;
}

export function AchievementPromotionDialogView({
	onComplete,
	labels,
	renderBadge,
	renderConfetti,
}: AchievementPromotionDialogViewProps): JSX.Element {
	const [confettiTriggerToken, setConfettiTriggerToken] = useState(0);
	const [textVisible, setTextVisible] = useState(false);
	const textRef = useRef<HTMLDivElement>(null);

	const revealText = useCallback(() => {
		textRef.current?.animate(
			[
				{ opacity: 0, transform: "translateY(16px)" },
				{ opacity: 1, transform: "translateY(0)" },
			],
			{
				duration: 500,
				easing: "cubic-bezier(0.22, 1, 0.36, 1)",
			},
		);
		setTextVisible(true);
	}, []);
	const hideText = useCallback(() => {
		setTextVisible(false);
	}, []);
	const celebrate = useCallback(() => {
		setConfettiTriggerToken((token) => token + 1);
	}, []);

	return (
		<Dialog open onOpenChange={(open) => !open && onComplete()}>
			<DialogContent
				className="h-[min(680px,calc(100vh-2rem))] overflow-visible border-transparent bg-transparent p-0 sm:max-w-[760px]"
				overlayClassName="bg-transparent supports-backdrop-filter:backdrop-blur-none"
				showCloseButton={false}
				onEscapeKeyDown={(event) => event.preventDefault()}
				onPointerDownOutside={(event) => event.preventDefault()}
			>
				<div
					ref={textRef}
					className={`pointer-events-none absolute inset-x-0 bottom-12 z-20 text-center transition-opacity ease-out ${
						textVisible ? "opacity-100" : "opacity-0"
					}`}
					style={{
						WebkitTextStroke: "2px var(--background)",
						paintOrder: "stroke fill",
						transitionDuration: textVisible ? "500ms" : "950ms",
					}}
				>
					<DialogTitle className="text-[20px] font-semibold text-primary">{labels.title}</DialogTitle>
					<DialogDescription className="mt-2 text-[15px] text-foreground">
						{labels.stageName}
					</DialogDescription>
				</div>
				<div className="relative z-10 h-full w-full">
					{renderBadge({
						onCelebrate: celebrate,
						onComplete,
						onHideText: hideText,
						onRevealText: revealText,
					})}
				</div>
				<div className="pointer-events-none absolute inset-0 z-15">
					{renderConfetti(confettiTriggerToken)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
