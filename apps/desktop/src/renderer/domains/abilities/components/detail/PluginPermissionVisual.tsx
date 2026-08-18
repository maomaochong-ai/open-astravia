import type { PluginPermission } from "@preload/api";
import { cn } from "@vetta/ui";
import { useTranslation } from "react-i18next";
import { PLUGIN_PERMISSION_PRESENTATIONS, type PluginPermissionVisualKind } from "../../lib/plugin-permission-labels";
import { PluginPermissionUiPreview } from "./PluginPermissionUiPreview";

const FLOW_ICONS: Record<PluginPermissionVisualKind, string> = {
	interface: "icon-[solar--widget-5-linear]",
	data: "icon-[solar--folder-with-files-linear]",
	agent: "icon-[solar--chat-round-dots-linear]",
	execution: "icon-[solar--command-linear]",
	external: "icon-[solar--global-linear]",
	intelligence: "icon-[solar--magic-stick-3-linear]",
};

function CapabilityFlow({ kind }: { kind: Exclude<PluginPermissionVisualKind, "interface"> }): JSX.Element {
	const { t } = useTranslation("abilities");
	const pluginFirst = kind === "execution" || kind === "external" || kind === "intelligence";
	const capability = (
		<div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
			<span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
				<span className={cn("h-5 w-5", FLOW_ICONS[kind])} />
			</span>
			<span className="text-[11px] leading-snug text-muted-foreground">{t(`permission.page.flow.${kind}`)}</span>
		</div>
	);
	const plugin = (
		<div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
			<span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
				<span className="icon-[solar--plug-circle-linear] h-5 w-5" />
			</span>
			<span className="text-[11px] leading-snug text-muted-foreground">{t("permission.page.flow.plugin")}</span>
		</div>
	);

	return (
		<figure>
			<div className="flex min-h-32 items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-5">
				{pluginFirst ? plugin : capability}
				<div className="flex shrink-0 items-center gap-1 text-muted-foreground/50">
					<span className="h-px w-4 bg-border" />
					<span className="icon-[solar--arrow-right-linear] h-3.5 w-3.5" />
					<span className="h-px w-4 bg-border" />
				</div>
				{pluginFirst ? capability : plugin}
			</div>
			<figcaption className="mt-2 text-[11px] text-muted-foreground">{t("permission.page.previewFlow")}</figcaption>
		</figure>
	);
}

export function PluginPermissionVisual({ permission }: { permission: PluginPermission }): JSX.Element {
	const presentation = PLUGIN_PERMISSION_PRESENTATIONS[permission];
	if (presentation.visual === "interface" && presentation.uiPreview) {
		return <PluginPermissionUiPreview preview={presentation.uiPreview} />;
	}
	return <CapabilityFlow kind={presentation.visual} />;
}
