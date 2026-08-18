import { SandboxGrantsBadgeView } from "@vetta/theme-ui/chat";
import { useSandboxGrantsBadgeModel } from "../hooks/useSandboxGrantsBadgeModel";

export function SandboxGrantsBadge(): JSX.Element | null {
	const model = useSandboxGrantsBadgeModel();
	if (!model) return null;

	return (
		<SandboxGrantsBadgeView
			count={model.count}
			open={model.open}
			grants={model.grants}
			labels={model.labels}
			containerRef={model.containerRef}
			onToggle={model.onToggle}
			onRevokeAll={model.onRevokeAll}
			onRevoke={model.onRevoke}
		/>
	);
}
