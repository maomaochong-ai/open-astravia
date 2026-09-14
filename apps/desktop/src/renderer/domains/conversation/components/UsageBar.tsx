import { UsageBarView } from "@vetta-org/theme-ui/chat";
import { useUsageBarModel } from "../hooks/useUsageBarModel";

export function UsageBar(): JSX.Element | null {
	const model = useUsageBarModel();
	if (!model) return null;
	return <UsageBarView text={model.text} />;
}
