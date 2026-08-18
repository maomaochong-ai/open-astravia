import { RequestHistorySubTabView } from "@vetta/theme-ui/activity";
import { useRequestHistorySubTabModel } from "../hooks/useRequestHistorySubTabModel";

export function RequestHistorySubTab({ cwd }: { cwd: string }): JSX.Element {
	const model = useRequestHistorySubTabModel(cwd);

	return (
		<RequestHistorySubTabView
			hasSession={model.hasSession}
			loading={model.loading}
			files={model.files}
			labels={model.labels}
			onRefresh={model.onRefresh}
			onPreview={model.onPreview}
			onShowInFolder={model.onShowInFolder}
		/>
	);
}
