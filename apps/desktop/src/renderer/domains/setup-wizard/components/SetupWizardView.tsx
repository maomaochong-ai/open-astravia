import { cn } from "@shared/lib/utils";
import { Button } from "@vetta/ui";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { SetupWizardModel } from "../hooks/useSetupWizard";
import type { SetupWizardStepId } from "../steps";
import { LanguageAppearanceStep } from "./steps/LanguageAppearanceStep";
import { LoginStep } from "./steps/LoginStep";
import { PermissionsStep } from "./steps/PermissionsStep";
import { WelcomeStep } from "./steps/WelcomeStep";

function StepBody({
	onLoginSuccess,
	step,
}: {
	onLoginSuccess: () => void;
	step: SetupWizardStepId;
}): JSX.Element {
	switch (step) {
		case "permissions":
			return <PermissionsStep />;
		case "languageAppearance":
			return <LanguageAppearanceStep />;
		case "login":
			return <LoginStep onSuccess={onLoginSuccess} />;
		case "welcome":
			return <WelcomeStep />;
	}
}

const easeOut = [0.22, 1, 0.36, 1] as const;
const softSpring = { type: "spring" as const, stiffness: 300, damping: 28 };
const snappySpring = { type: "spring" as const, stiffness: 380, damping: 26 };

function StepIndicator({
	stepIndex,
	totalSteps,
}: {
	stepIndex: number;
	totalSteps: number;
}): JSX.Element {
	return (
		<div className="flex items-center gap-2" aria-hidden>
			{Array.from({ length: totalSteps }, (_, i) => {
				const active = i === stepIndex;
				const done = i < stepIndex;
				return (
					<span key={i} className="relative flex h-2 items-center justify-center">
						{active ? (
							<motion.span
								layoutId="setup-wizard-active-dot"
								className="block h-1.5 w-5 rounded-full bg-primary"
								transition={softSpring}
							/>
						) : (
							<motion.span
								className={cn(
									"block h-1.5 w-1.5 rounded-full",
									done ? "bg-primary/50" : "bg-muted-foreground/25",
								)}
								initial={false}
								animate={{
									scale: done ? 1 : 0.9,
									opacity: done ? 1 : 0.7,
								}}
								transition={{ duration: 0.22, ease: easeOut }}
							/>
						)}
					</span>
				);
			})}
		</div>
	);
}

export function SetupWizardView({ model }: { model: SetupWizardModel }): JSX.Element | null {
	if (!model.open) return null;

	const { actions, currentStep, isFirst, isLast, labels, stepIndex, totalSteps } = model;

	return (
		<div className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground">
			{/* macOS traffic-light 区拖拽 + 右上角 Skip */}
			<div className="relative flex h-12 shrink-0 items-center justify-end px-4 [-webkit-app-region:drag]">
				<Button
					variant="ghost"
					size="sm"
					className="relative z-10 [-webkit-app-region:no-drag] text-muted-foreground"
					onClick={actions.skip}
				>
					{labels.skip}
				</Button>
			</div>

			<div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-2 pt-1">
				<div className="flex w-full max-w-[560px] flex-1 flex-col justify-center py-3">
					<AnimatePresence mode="wait" initial={false}>
						<motion.div
							key={currentStep}
							initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
							animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
							exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
							transition={{ duration: 0.32, ease: easeOut }}
						>
							<StepBody step={currentStep} onLoginSuccess={actions.next} />
						</motion.div>
					</AnimatePresence>
				</div>
			</div>

			{/* 无边框 stepper：指示点 + 操作，居中紧凑 */}
			<div className="flex shrink-0 flex-col items-center gap-4 px-6 pb-10 pt-2">
				<StepIndicator stepIndex={stepIndex} totalSteps={totalSteps} />

				<LayoutGroup id="setup-wizard-actions">
					<div className="flex items-center gap-3">
						<div className="flex h-9 w-[5.5rem] items-center justify-end">
							<AnimatePresence initial={false} mode="popLayout">
								{!isFirst && (
									<motion.div
										key="back"
										initial={{ opacity: 0, x: -8 }}
										animate={{ opacity: 1, x: 0 }}
										exit={{ opacity: 0, x: -8 }}
										transition={snappySpring}
									>
										<motion.div whileHover={{ x: -2 }} whileTap={{ scale: 0.96 }} transition={snappySpring}>
											<Button
												variant="ghost"
												size="sm"
												onClick={actions.back}
												className="gap-1 text-muted-foreground hover:text-foreground"
											>
												<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" />
												{labels.back}
											</Button>
										</motion.div>
									</motion.div>
								)}
							</AnimatePresence>
						</div>

						<motion.div layout transition={softSpring} className="min-w-[9.5rem]">
							<AnimatePresence mode="wait" initial={false}>
								<motion.div
									key={isLast ? "done" : "next"}
									initial={{ opacity: 0, y: 8, scale: 0.98 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									exit={{ opacity: 0, y: -6, scale: 0.98 }}
									transition={{ duration: 0.2, ease: easeOut }}
								>
									<motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} transition={snappySpring}>
										{isLast ? (
											<Button className="h-9 w-full gap-1.5 px-5" onClick={actions.complete}>
												{labels.getStarted}
												<span className="icon-[solar--arrow-right-linear] h-3.5 w-3.5" />
											</Button>
										) : (
											<Button className="h-9 w-full gap-1.5 px-5" onClick={actions.next}>
												{labels.next}
												<span className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5" />
											</Button>
										)}
									</motion.div>
								</motion.div>
							</AnimatePresence>
						</motion.div>
					</div>
				</LayoutGroup>
			</div>
		</div>
	);
}
