import { BuiltinMcpSecretsDialogView } from "./BuiltinMcpSecretsDialogView";
import { useBuiltinMcpSecretsDialogModel } from "./useBuiltinMcpSecretsDialogModel";
import type { BuiltinMcpPreset } from "../mcp/builtin-mcp-presets";

export function BuiltinMcpSecretsDialog({
	open,
	preset,
	initialValues,
	saving,
	authorizing,
	error,
	onOpenChange,
	onConfirm,
}: {
	open: boolean;
	preset: BuiltinMcpPreset | null;
	initialValues?: Record<string, string>;
	saving?: boolean;
	authorizing?: boolean;
	error?: string | null;
	onOpenChange: (open: boolean) => void;
	onConfirm: (values: Record<string, string>) => void;
}): JSX.Element | null {
	const model = useBuiltinMcpSecretsDialogModel({
		open,
		preset,
		initialValues,
		saving,
		authorizing,
		error,
	});
	if (!model) return null;
	return (
		<BuiltinMcpSecretsDialogView {...model} onConfirm={onConfirm} onOpenChange={onOpenChange} />
	);
}
