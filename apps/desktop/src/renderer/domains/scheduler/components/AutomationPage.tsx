import { useAutomationPageModel } from "../hooks/useAutomationPageModel";
import { AutomationPageView } from "./AutomationPageView";

export function AutomationPage(): JSX.Element {
	return <AutomationPageView {...useAutomationPageModel()} />;
}
