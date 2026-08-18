import {
	BuiltinMcpSecretsDialogView as ThemeBuiltinMcpSecretsDialogView,
	type BuiltinMcpSecretsDialogViewLabels,
	type BuiltinMcpSecretsDialogViewProps as ThemeProps,
} from "@vetta/theme-ui/settings";
import type { BuiltinMcpSecretsDialogModel } from "./useBuiltinMcpSecretsDialogModel";

export type { BuiltinMcpSecretsDialogViewLabels };

export interface BuiltinMcpSecretsDialogViewProps extends BuiltinMcpSecretsDialogModel {
	readonly onConfirm: (values: Record<string, string>) => void;
	readonly onOpenChange: (open: boolean) => void;
}

export function BuiltinMcpSecretsDialogView({
	appIconUrl,
	canSubmit,
	connectorIconUrl,
	connectorName,
	fields,
	guideLines,
	hasFields,
	labels,
	onChangeValue,
	onConfirm,
	onOpenChange,
	onOpenHelp,
	open,
	primaryHelpUrl,
	saving,
	authorizing,
	error,
	values,
}: BuiltinMcpSecretsDialogViewProps): JSX.Element {
	const themeProps: ThemeProps = {
		appIconUrl,
		canSubmit,
		connectorIconUrl,
		connectorName,
		fields,
		guideLines,
		hasFields,
		labels,
		onChangeValue,
		onConfirm,
		onOpenChange,
		onOpenHelp,
		open,
		primaryHelpUrl,
		saving,
		authorizing,
		error,
		values,
	};
	return <ThemeBuiltinMcpSecretsDialogView {...themeProps} />;
}
