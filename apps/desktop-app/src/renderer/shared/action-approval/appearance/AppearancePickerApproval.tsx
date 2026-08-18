import { AppearancePickerApprovalView } from "./AppearancePickerApprovalView";
import { useAppearancePickerApprovalModel } from "./useAppearancePickerApprovalModel";

export function AppearancePickerApproval(): JSX.Element | null {
	const model = useAppearancePickerApprovalModel();
	if (!model) return null;
	return <AppearancePickerApprovalView key={model.approvalId} {...model} />;
}
