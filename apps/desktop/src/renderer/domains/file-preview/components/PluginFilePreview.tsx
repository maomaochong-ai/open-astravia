import type { PluginFilePreviewContribution } from "@vetta-org/plugin-sdk";
import type { FilePreviewItem } from "@vetta/theme-ui/file-preview";
import { PluginFilePreviewView } from "@vetta/theme-ui/file-preview";
import { usePluginFilePreviewModel } from "../hooks/usePluginFilePreviewModel";

/**
 * Builds the host-mediated content accessors and renders a plugin's file
 * preview component. Content access is permission-free: the user explicitly
 * opened this one file and the host hands it over (not arbitrary fs access).
 */
export function PluginFilePreview({
	item,
	ext,
	component,
}: {
	item: FilePreviewItem;
	ext: string;
	component: PluginFilePreviewContribution["component"];
}): JSX.Element {
	const model = usePluginFilePreviewModel(item, ext, component);
	return <PluginFilePreviewView file={model.file} component={model.component} />;
}
