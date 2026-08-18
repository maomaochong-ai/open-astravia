import { UsageStatsView } from "@vetta/theme-ui/settings";
import { useUsageStatsModel } from "./useUsageStatsModel";

export function UsageStats(): JSX.Element | null {
	const model = useUsageStatsModel();
	if (!model) return null;
	return <UsageStatsView {...model} />;
}
