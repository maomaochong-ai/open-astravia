import { BuiltinMcpSecretsDialog } from "../../settings/components/BuiltinMcpSecretsDialog";
import { ManualMcpDialog } from "../../settings/components/ManualMcpDialog";
import { McpEditDialog } from "../../settings/components/McpEditDialog";
import type { McpSettingsModel } from "../../settings/components/useMcpSettingsModel";

/** mcp 轨道自带的三个编辑器，列表页与详情页都要挂载。 */
export function AbilityMcpDialogs({ mcp }: { mcp: McpSettingsModel }): JSX.Element {
	return (
		<>
			<ManualMcpDialog model={mcp} />
			<McpEditDialog model={mcp} />
			<BuiltinMcpSecretsDialog
				open={mcp.secretsDialogPreset !== null}
				preset={mcp.secretsDialogPreset}
				initialValues={mcp.secretsDialogInitial}
				saving={mcp.saving || (mcp.busyPresetName !== null && !mcp.secretsDialogAuthorizing)}
				authorizing={mcp.secretsDialogAuthorizing}
				error={mcp.secretsDialogError}
				onOpenChange={(open) => {
					if (!open) mcp.onCloseSecretsDialog();
				}}
				onConfirm={(values) => void mcp.onConfirmSecretsDialog(values)}
			/>
		</>
	);
}
