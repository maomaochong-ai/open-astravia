import { PluginWorkspaceViewSurface } from "@domains/plugins/components/PluginWorkspaceViewRoute";
import { useThemeSurface } from "@vetta/theme-sdk/appearance";
import type { SettingsTab } from "@shared/store/atoms";
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { SettingsPageView } from "./SettingsPageView";
import { useSettingsPageModel } from "./useSettingsPageModel";
import "./settings-highlight.css";

const AccountSettings = lazy(async () => ({ default: (await import("./AccountSettings")).AccountSettings }));
const AgentSettings = lazy(async () => ({ default: (await import("./AgentSettings")).AgentSettings }));
const AppearanceSettings = lazy(async () => ({
	default: (await import("./AppearanceSettings")).AppearanceSettings,
}));
const AppshotSettings = lazy(async () => ({ default: (await import("./AppshotSettings")).AppshotSettings }));
const ArchivedProjectsSettings = lazy(async () => ({
	default: (await import("./ArchivedProjectsSettings")).ArchivedProjectsSettings,
}));
const ExtensionsSettings = lazy(async () => ({
	default: (await import("./ExtensionsSettings")).ExtensionsSettings,
}));
const EnvironmentSettings = lazy(async () => ({
	default: (await import("./EnvironmentSettings")).EnvironmentSettings,
}));
const GeneralSettings = lazy(async () => ({ default: (await import("./GeneralSettings")).GeneralSettings }));
const ImBridgeSettings = lazy(async () => ({ default: (await import("./ImBridgeSettings")).ImBridgeSettings }));
const KnowledgeBaseSettings = lazy(async () => ({
	default: (await import("./KnowledgeBaseSettings")).KnowledgeBaseSettings,
}));
const ModelsSettings = lazy(async () => ({ default: (await import("./ModelsSettings")).ModelsSettings }));
const PermissionsSettings = lazy(async () => ({
	default: (await import("./PermissionsSettings")).PermissionsSettings,
}));
const RemotePairingSettings = lazy(async () => ({ default: (await import("./RemotePairingSettings")).RemotePairingSettings }));
const PetSettings = lazy(async () => ({ default: (await import("./PetSettings")).PetSettings }));
const ShortcutsSettings = lazy(async () => ({
	default: (await import("./ShortcutsSettings")).ShortcutsSettings,
}));
const TeamSettings = lazy(async () => ({ default: (await import("./TeamSettings")).TeamSettings }));
const WebhookSettings = lazy(async () => ({ default: (await import("./WebhookSettings")).WebhookSettings }));

/** MCP 已迁至扩展 → 连接器；`mcp` 保留在 SettingsTab 供 analytics / 旧链接重定向，此处不渲染。 */
const SETTINGS_CONTENT: Record<Exclude<SettingsTab, "mcp">, LazyExoticComponent<ComponentType>> = {
	general: GeneralSettings,
	appearance: AppearanceSettings,
	account: AccountSettings,
	models: ModelsSettings,
	environment: EnvironmentSettings,
	extensions: ExtensionsSettings,
	permissions: PermissionsSettings,
	im: ImBridgeSettings,
	webhook: WebhookSettings,
	shortcuts: ShortcutsSettings,
	appshot: AppshotSettings,
	archive: ArchivedProjectsSettings,
	team: TeamSettings,
	context: AgentSettings,
	knowledge: KnowledgeBaseSettings,
	pet: PetSettings,
	remote: RemotePairingSettings,
};

export function SettingsPage(): JSX.Element {
	const model = useSettingsPageModel();
	const contentSurface = useThemeSurface("settings.pageContent");
	const Content =
		model.activeTab === "mcp" ? SETTINGS_CONTENT.general : SETTINGS_CONTENT[model.activeTab];

	const activeTab = model.activeTab === "mcp" ? "general" : model.activeTab;
	const embedded = model.embeddedView;

	// 内嵌的插件视图是整页 surface：给它完整宽高，不套设置页的居中窄栏。
	// 找不到该视图时退回「更多选项」列表，而不是把用户踢出设置。
	const content = embedded ? (
		<PluginWorkspaceViewSurface
			key={`${embedded.pluginId}:${embedded.viewId}`}
			pluginId={embedded.pluginId}
			viewId={embedded.viewId}
			onMissing={model.onCloseEmbeddedView}
		/>
	) : (
		<Suspense fallback={null}>
			{/* key=tab：切换侧栏时重挂载，避免不同 tab 复用同一组件实例的残留状态 */}
			<div key={activeTab} className="w-full min-h-0">
				<Content />
			</div>
		</Suspense>
	);

	return (
		<SettingsPageView
			content={content}
			contentSurfaceRootClassName={contentSurface?.rootClassName}
			fillContent={Boolean(embedded)}
			model={model}
		/>
	);
}
