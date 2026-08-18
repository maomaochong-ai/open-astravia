import { useSetupWizard } from "../hooks/useSetupWizard";
import { SetupWizardView } from "./SetupWizardView";

export function SetupWizard(): JSX.Element | null {
	const model = useSetupWizard();
	return <SetupWizardView model={model} />;
}
