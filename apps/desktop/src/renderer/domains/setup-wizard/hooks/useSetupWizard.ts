import { authTokenAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSetupWizardSteps, type SetupWizardStepId } from "../steps";
import { isSetupWizardCompleted, markSetupWizardCompleted, SETUP_WIZARD_OPEN_EVENT } from "../storage";

export interface SetupWizardModel {
	readonly actions: {
		back: () => void;
		complete: () => void;
		next: () => void;
		skip: () => void;
	};
	readonly currentStep: SetupWizardStepId;
	readonly isFirst: boolean;
	readonly isLast: boolean;
	readonly labels: {
		readonly back: string;
		readonly getStarted: string;
		readonly next: string;
		readonly progress: string;
		readonly skip: string;
	};
	readonly open: boolean;
	readonly stepIndex: number;
	readonly steps: readonly SetupWizardStepId[];
	readonly totalSteps: number;
}

function resolveSteps(isLoggedIn: boolean): readonly SetupWizardStepId[] {
	return getSetupWizardSteps({ isLoggedIn });
}

export function useSetupWizard(): SetupWizardModel {
	const { t } = useTranslation("common");
	const token = useAtomValue(authTokenAtom);

	const [open, setOpen] = useState(() => !isSetupWizardCompleted());
	// Freeze step list for the current open session so mid-wizard login does not
	// shrink the indicator / scramble stepIndex; re-open recomputes from auth.
	const [steps, setSteps] = useState<readonly SetupWizardStepId[]>(() => resolveSteps(Boolean(token)));
	const [stepIndex, setStepIndex] = useState(0);

	const openWizard = useCallback(() => {
		setSteps(resolveSteps(Boolean(token)));
		setStepIndex(0);
		setOpen(true);
	}, [token]);

	useEffect(() => {
		const onOpen = () => openWizard();
		window.addEventListener(SETUP_WIZARD_OPEN_EVENT, onOpen);
		return () => window.removeEventListener(SETUP_WIZARD_OPEN_EVENT, onOpen);
	}, [openWizard]);

	const finish = useCallback(() => {
		markSetupWizardCompleted();
		setOpen(false);
	}, []);

	const next = useCallback(() => {
		setStepIndex((index) => {
			if (index >= steps.length - 1) {
				finish();
				return index;
			}
			return index + 1;
		});
	}, [finish, steps.length]);

	const back = useCallback(() => {
		setStepIndex((index) => Math.max(0, index - 1));
	}, []);

	const currentStep = steps[stepIndex] ?? steps[0];
	const isFirst = stepIndex === 0;
	const isLast = stepIndex === steps.length - 1;

	const labels = useMemo(
		() => ({
			back: t("setupWizard.back"),
			getStarted: t("setupWizard.getStarted"),
			next: t("setupWizard.next"),
			progress: t("setupWizard.progress", { current: stepIndex + 1, total: steps.length }),
			skip: t("setupWizard.skip"),
		}),
		[stepIndex, steps.length, t],
	);

	return {
		actions: {
			back,
			complete: finish,
			next,
			skip: finish,
		},
		currentStep,
		isFirst,
		isLast,
		labels,
		open,
		stepIndex,
		steps,
		totalSteps: steps.length,
	};
}
