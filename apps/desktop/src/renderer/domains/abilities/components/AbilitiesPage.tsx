import { pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useAbilitiesModel } from "../hooks/useAbilitiesModel";
import { AbilitiesPageView } from "./AbilitiesPageView";
import { McpSetupPrompt } from "./McpSetupPrompt";
import { PluginPermissionPrompt } from "./PluginPermissionPrompt";

/**
 * 详情抽屉懒加载：它的子树静态拖着 markdown 渲染 + shiki 全量高亮器，若同步 import
 * 会把这几百 KB 打进能力页首开 chunk——首次点击「能力」的解析/求值大头正是它。
 * 首次带 ?detail= 打开时才拉取；之后保持挂载以保留关闭动画。
 */
const AbilityDetailSheet = lazy(async () => ({
	default: (await import("./detail/AbilityDetailSheet")).AbilityDetailSheet,
}));

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

	// 首次请求过详情后保持挂载：懒 chunk 已就位，关闭动画与再次打开都不受影响。
	const [detailEverRequested, setDetailEverRequested] = useState(false);
	useEffect(() => {
		if (detail) setDetailEverRequested(true);
	}, [detail]);

	return (
		<>
			<AbilitiesPageView model={model} />
			{(detail !== undefined || detailEverRequested) && (
				<Suspense fallback={null}>
					<AbilityDetailSheet detailId={detail ?? null} model={model} onClose={closeDetail} />
				</Suspense>
			)}
			<PluginPermissionPrompt model={model} />
			<McpSetupPrompt model={model} />
		</>
	);
}
