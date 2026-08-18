import { useThemeRegion } from "@vetta/theme-sdk";
import { useSidebarModel } from "@vetta/theme-sdk/sidebar";
import { memo } from "react";
import { DefaultSidebar } from "./DefaultSidebar";
import type { SidebarProps } from "./types";

/**
 * memo：RootLayoutView 同时挂了 `useProjects()` 与 `useSessionManager()`，后者订阅了
 * 附件、提及文件、选中 skill/模型、todo、批量项目等一堆与侧栏无关的 atom。没有 memo 时，
 * 输入框贴张图、流式期间 todo 更新、任何一次 listSessions 回填，都会把整条侧栏重渲染一遍。
 */
export const Sidebar = memo(function Sidebar(props: SidebarProps): JSX.Element {
	const model = useSidebarModel(props);
	const ThemeSidebar = useThemeRegion("sidebar");
	if (ThemeSidebar) {
		return (
			<ThemeSidebar
				classNames={props.classNames}
				model={model}
				onOpenSession={props.onOpenSession}
			/>
		);
	}
	return (
		<DefaultSidebar
			classNames={props.classNames}
			model={model}
			onOpenSession={props.onOpenSession}
		/>
	);
});
