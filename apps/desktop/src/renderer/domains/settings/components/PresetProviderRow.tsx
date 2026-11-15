import { ProviderIcon } from "@astravia-org/theme-ui/shared";
import { PresetProviderRowView } from "@astravia-org/theme-ui/settings";
import { PresetProviderModelsList } from "./PresetProviderModelsList";
import type {
	PresetProviderRow as PresetProviderRowModel,
	PresetProvidersSectionLabels,
} from "./usePresetProvidersSectionModel";

export function PresetProviderRow({
	row,
	draftKey,
	saving,
	labels,
	onToggleExpanded,
	onToggleEditor,
	onDraftKeyChange,
	onAdopt,
	onRemove,
	onToggleEnabled,
	onSetPort,
	onRefreshModels,
	onCopyApiKey,
}: {
	row: PresetProviderRowModel;
	draftKey: string;
	saving: boolean;
	labels: PresetProvidersSectionLabels;
	onToggleExpanded: (row: PresetProviderRowModel) => void;
	onToggleEditor: (row: PresetProviderRowModel) => void;
	onDraftKeyChange: (rowId: string, key: string) => void;
	onAdopt: (row: PresetProviderRowModel) => Promise<void>;
	onRemove: (row: PresetProviderRowModel) => Promise<void>;
	onToggleEnabled: (row: PresetProviderRowModel, enabled: boolean) => Promise<void>;
	onSetPort: (row: PresetProviderRowModel, port: string) => Promise<void>;
	onRefreshModels: (row: PresetProviderRowModel) => Promise<void>;
	onCopyApiKey: (row: PresetProviderRowModel) => Promise<void>;
}): JSX.Element {
	return (
		<PresetProviderRowView
			row={row}
			draftKey={draftKey}
			saving={saving}
			labels={labels}
			onToggleExpanded={() => onToggleExpanded(row)}
			onToggleEditor={() => onToggleEditor(row)}
			onDraftKeyChange={(key) => onDraftKeyChange(row.id, key)}
			onAdopt={() => void onAdopt(row)}
			onRemove={() => void onRemove(row)}
			onToggleEnabled={(enabled) => void onToggleEnabled(row, enabled)}
			onSetPort={(port) => void onSetPort(row, port)}
			toggleLabel={labels.toggleProvider(row.displayName)}
			onRefreshModels={() => void onRefreshModels(row)}
			onCopyApiKey={() => void onCopyApiKey(row)}
			icon={<ProviderIcon symbol={row.icon} className="h-7 w-7 shrink-0" />}
			modelsList={<PresetProviderModelsList row={row} labels={labels} />}
		/>
	);
}
