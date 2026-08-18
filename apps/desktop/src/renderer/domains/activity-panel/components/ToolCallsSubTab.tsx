import { ToolCallsSubTabView } from "@vetta/theme-ui/activity";
import { useToolCallsSubTabModel } from "../hooks/useToolCallsSubTabModel";

export function ToolCallsSubTab({ cwd: _cwd }: { cwd: string }): JSX.Element {
	const model = useToolCallsSubTabModel();

	return (
		<ToolCallsSubTabView
			hasSession={model.hasSession}
			search={model.search}
			filter={model.filter}
			filterOptions={model.filterOptions}
			loading={model.loading}
			hasAnyRecords={model.hasAnyRecords}
			items={model.items}
			expandedId={model.expandedId}
			labels={model.labels}
			onSearchChange={model.onSearchChange}
			onFilterChange={model.onFilterChange}
			onToggleExpand={model.onToggleExpand}
			onRefresh={model.onRefresh}
		/>
	);
}
