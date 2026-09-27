import { useThemeSurface } from "@astravia/theme-sdk/appearance";
import { pluginWorkspaceViewsAtom, type SettingsTab } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { lazy, Suspense, useState, useEffect, type ComponentType, type LazyExoticComponent } from "react";
import { SettingsPageView } from "./SettingsPageView";
import { useSettingsPageModel } from "./useSettingsPageModel";
import { PluginI18nBoundary } from "@domains/plugins/runtime/plugin-i18n";
import { waitForPluginHostReady } from "@domains/plugins/runtime/plugin-events";
import "./settings-highlight.css";

/** 直接渲染 browser preset 的 console 工作区视图——不套卡片列表、不需要二次点击。 */
function ExtensionsTabContent(): JSX.Element {
	const workspaceViews = useAtomValue(pluginWorkspaceViewsAtom);
	const [hostReady, setHostReady] = useState(false);
	const browserView = workspaceViews.find((v) => v.pluginId === "browser" && v.viewId === "console");

	useEffect(() => {
		let cancelled = false;
		void waitForPluginHostReady().then(() => {
			if (!cancelled) setHostReady(true);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	if (!browserView) {
		return (
			<div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
				{hostReady ? "浏览器控制插件未安装" : "正在加载插件宿主…"}
			</div>
		);
	}

	const ViewComponent = browserView.component;
	return (
		<PluginI18nBoundary pluginId={browserView.pluginId}>
			<ViewComponent pluginId={browserView.pluginId} viewId={browserView.viewId} />
		</PluginI18nBoundary>
	);
}

const AgentSettings = lazy(async () => ({ default: (await import("./AgentSettings")).AgentSettings }));
const AppearanceSettings = lazy(async () => ({
	default: (await import("./AppearanceSettings")).AppearanceSettings,
}));
const AppshotSettings = lazy(async () => ({ default: (await import("./AppshotSettings")).AppshotSettings }));
const ArchivedProjectsSettings = lazy(async () => ({
	default: (await import("./ArchivedProjectsSettings")).ArchivedProjectsSettings,
}));
const EnvironmentSettings = lazy(async () => ({
	default: (await import("./EnvironmentSettings")).EnvironmentSettings,
}));
const GeneralSettings = lazy(async () => ({ default: (await import("./GeneralSettings")).GeneralSettings }));
const ImBridgeSettings = lazy(async () => ({ default: (await import("./ImBridgeSettings")).ImBridgeSettings }));
const KnowledgeBaseSettings = lazy(async () => ({
	default: (await import("./KnowledgeBaseSettings")).KnowledgeBaseSettings,
}));
const DatabaseSettings = lazy(async () => ({
	default: (await import("./DatabaseSettings")).DatabaseSettings,
}));
const ModelsSettings = lazy(async () => ({ default: (await import("./ModelsSettings")).ModelsSettings }));
const PermissionsSettings = lazy(async () => ({
	default: (await import("./PermissionsSettings")).PermissionsSettings,
}));
const PetSettings = lazy(async () => ({ default: (await import("./PetSettings")).PetSettings }));
const PluginsSettings = lazy(async () => ({ default: (await import("./PluginsSettings")).PluginsSettings }));
const ShortcutsSettings = lazy(async () => ({
	default: (await import("./ShortcutsSettings")).ShortcutsSettings,
}));
const WebhookSettings = lazy(async () => ({ default: (await import("./WebhookSettings")).WebhookSettings }));

// ExtensionsTabContent 是文件内联组件，不是 lazy 模块，包装成 LazyExoticComponent 以统一签名
const ExtensionsSettingsLazy = lazy(async () => ({ default: ExtensionsTabContent }));

/** MCP 已迁至扩展 → 连接器；`mcp` 保留在 SettingsTab 供 analytics / 旧链接重定向，此处不渲染。 */
const SETTINGS_CONTENT: Record<Exclude<SettingsTab, "mcp">, LazyExoticComponent<ComponentType>> = {
	general: GeneralSettings,
	appearance: AppearanceSettings,
	models: ModelsSettings,
	environment: EnvironmentSettings,
	permissions: PermissionsSettings,
	im: ImBridgeSettings,
	webhook: WebhookSettings,
	shortcuts: ShortcutsSettings,
	appshot: AppshotSettings,
	archive: ArchivedProjectsSettings,
	context: AgentSettings,
	browser: ExtensionsSettingsLazy,
	plugins: PluginsSettings,
	knowledge: KnowledgeBaseSettings,
	database: DatabaseSettings,
	pet: PetSettings,
};

export function SettingsPage(): JSX.Element {
	const model = useSettingsPageModel();
	const contentSurface = useThemeSurface("settings.pageContent");
	const Content =
		model.activeTab === "mcp" ? SETTINGS_CONTENT.general : SETTINGS_CONTENT[model.activeTab];

	const activeTab = model.activeTab === "mcp" ? "general" : model.activeTab;

	return (
		<SettingsPageView
			content={
				<Suspense fallback={null}>
					{/* key=tab：切换侧栏时重挂载，避免不同 tab 复用同一组件实例的残留状态 */}
					<div key={activeTab} className="flex h-full min-h-0 w-full flex-col">
						<Content />
					</div>
				</Suspense>
			}
			contentSurfaceRootClassName={contentSurface?.rootClassName}
			model={model}
		/>
	);
}
