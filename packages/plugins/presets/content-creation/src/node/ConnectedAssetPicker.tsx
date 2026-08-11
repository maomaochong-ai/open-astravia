import type { ConnectedContentAsset } from "./material-assets";
import { ContentAssetPicker, type ContentAssetPickerOption } from "./ContentAssetPicker";

export interface ConnectedReferenceOption extends ConnectedContentAsset {
	slotId: string | null;
}

interface ConnectedAssetPickerProps {
	options: readonly ConnectedReferenceOption[];
	disabled: boolean;
	compact?: boolean;
	onSelect: (option: ConnectedReferenceOption) => void;
}

export function ConnectedAssetPicker({
	options,
	disabled,
	compact = false,
	onSelect,
}: ConnectedAssetPickerProps) {
	return (
		<ContentAssetPicker
			options={options.map((option): ContentAssetPickerOption & { connected: ConnectedReferenceOption } => ({
				id: `${option.sourceNodeId}:${option.asset.id}:${option.slotId ?? "unsupported"}`,
				asset: option.asset,
				source: "workflow",
				disabled: !option.slotId,
				disabledTitleKey: "nodeEditor.reference.assetUnsupported",
				connected: option,
			}))}
			disabled={disabled}
			compact={compact}
			labelKey="nodeEditor.reference.fromAssets"
			onSelect={(option) => onSelect(option.connected)}
		/>
	);
}
