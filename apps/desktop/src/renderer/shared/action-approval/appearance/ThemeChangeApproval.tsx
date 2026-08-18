import { ThemeChangeApprovalView } from "./ThemeChangeApprovalView";
import { useThemeChangeApprovalModel } from "./useThemeChangeApprovalModel";

export function ThemeChangeApproval(): JSX.Element | null {
	const model = useThemeChangeApprovalModel();
	if (!model) return null;
	return <ThemeChangeApprovalView key={model.approvalId} {...model} />;
}
