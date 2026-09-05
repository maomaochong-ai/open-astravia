import { pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { lazy, Suspense, useCallback, useEffect } from "react";
import { useAbilitiesModel } from "../hooks/useAbilitiesModel";
import { AbilitiesPageView } from "./AbilitiesPageView";
import { McpSetupPrompt } from "./McpSetupPrompt";
import { PluginPermissionPrompt } from "./PluginPermissionPrompt";
import { loadAbilityDetailSheet } from "./detail/loadAbilityDetailSheet";

/**
 * 详情抽屉懒加载：它的子树静态拖着 markdown 渲染 + shiki 全量高亮器，若同步 import
 * 会把这几百 KB 打进能力页首开 chunk——首次点击「能力」的解析/求值大头正是它。
 * 页面首帧后在空闲期预取；关闭时卸载抽屉以免退出动画遮罩阻塞列表。
 */
const AbilityDetailSheet = lazy(loadAbilityDetailSheet);

export function AbilitiesPage(): JSX.Element {
	const model = useAbilitiesModel();
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const navigate = useNavigate();
	// 详情抽屉由来源感知的 catalog id 驱动：同 slug 可并存，返回键即关闭。
	const { detail } = useSearch({ strict: false }) as { detail?: string };

	// 页面内已有大号标题，隐藏顶栏左上角路由标题。
	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	const closeDetail = useCallback(() => {
		void navigate({ to: "/abilities", search: {}, replace: true });
	}, [navigate]);

	// 页面壳完成首帧后预取详情 chunk。真正打开详情时只需等待尚未完成的网络请求，
	// 不会把 Markdown/Shiki 的解析放在能力列表的同步渲染路径上。
	useEffect(() => {
		let cancelled = false;
		const preload = (): void => {
			if (!cancelled) void loadAbilityDetailSheet().catch(() => undefined);
		};
		if (typeof window.requestIdleCallback === "function") {
			const id = window.requestIdleCallback(preload, { timeout: 2000 });
			return () => {
				cancelled = true;
				window.cancelIdleCallback(id);
			};
		}
		const id = window.setTimeout(preload, 1000);
		return () => {
			cancelled = true;
			window.clearTimeout(id);
		};
	}, []);

	return (
		<>
			<AbilitiesPageView model={model} />
			{detail !== undefined && (
				<Suspense fallback={null}>
					<AbilityDetailSheet detailId={detail ?? null} model={model} onClose={closeDetail} />
				</Suspense>
			)}
			<PluginPermissionPrompt model={model} />
			<McpSetupPrompt model={model} />
		</>
	);
}
