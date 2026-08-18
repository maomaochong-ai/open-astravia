import { forwardRef, useImperativeHandle } from "react";
import { ManualMcpDialog } from "./ManualMcpDialog";
import { McpEditDialog } from "./McpEditDialog";
import { McpSettingsView } from "./McpSettingsView";
import { useMcpSettingsModel } from "./useMcpSettingsModel";

export { CheckboxField, TextareaField } from "./SettingsFormFields";

export interface McpSettingsHandle {
	/** 打开「自定义连接器」添加对话框。 */
	openCustomConnector: () => void;
}

export const McpSettings = forwardRef<McpSettingsHandle>(function McpSettings(_props, ref): JSX.Element {
	const model = useMcpSettingsModel();

	useImperativeHandle(
		ref,
		() => ({
			openCustomConnector: () => {
				model.onStartAddServer();
			},
		}),
		[model],
	);

	return (
		<>
			<McpSettingsView model={model} />
			<ManualMcpDialog model={model} />
			<McpEditDialog model={model} />
		</>
	);
});
