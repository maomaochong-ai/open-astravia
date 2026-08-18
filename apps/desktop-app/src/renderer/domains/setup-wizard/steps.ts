import { isMac } from "@shared/lib/platform";

export type SetupWizardStepId = "permissions" | "languageAppearance" | "login" | "welcome";

export interface GetSetupWizardStepsOptions {
	/** When true, omit the optional login step (already signed in). */
	readonly isLoggedIn?: boolean;
}

/** macOS: language/appearance → permissions → login → welcome; other platforms skip permissions. */
export function getSetupWizardSteps(options?: GetSetupWizardStepsOptions): readonly SetupWizardStepId[] {
	const base: readonly SetupWizardStepId[] = isMac
		? ["languageAppearance", "permissions", "login", "welcome"]
		: ["languageAppearance", "login", "welcome"];
	if (options?.isLoggedIn) {
		return base.filter((step) => step !== "login");
	}
	return base;
}
