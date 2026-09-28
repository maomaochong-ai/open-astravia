import { SandboxGrantsBadgeView } from "@vetta-org/theme-ui/chat";
import { useSandboxGrantsBadgeModel } from "../hooks/useSandboxGrantsBadgeModel";

export function SandboxGrantsBadge({ runtimeIds }: { readonly runtimeIds: readonly string[] }): JSX.Element | null {
	const model = useSandboxGrantsBadgeModel(runtimeIds);
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
