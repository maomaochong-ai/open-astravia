import type { RegisteredFileExplorerDecorationProvider, RegisteredFileIconTheme } from "@shared/store/atoms";
import type { LoadedPlugin } from "../runtime/plugin-local-contributions";

export function collectFileExplorerContributions(
	plugins: readonly Pick<LoadedPlugin, "id" | "fileExplorerDecorationProviders" | "fileIconThemes">[],
): {
	decorations: RegisteredFileExplorerDecorationProvider[];
	themes: RegisteredFileIconTheme[];
} {
	return {
		decorations: plugins.flatMap((plugin) =>
			plugin.fileExplorerDecorationProviders.map((provider) => ({
				...provider,
				pluginId: plugin.id,
				providerId: provider.id,
			})),
		),
		themes: plugins.flatMap((plugin) => plugin.fileIconThemes.map((theme) => ({ ...theme, pluginId: plugin.id }))),
	};
}
