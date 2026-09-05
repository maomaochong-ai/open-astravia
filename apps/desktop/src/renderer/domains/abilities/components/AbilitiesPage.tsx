import { pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useAbilitiesModel } from "../hooks/useAbilitiesModel";
import { AbilitiesPageView } from "./AbilitiesPageView";
import { McpSetupPrompt } from "./McpSetupPrompt";
import { PluginPermissionPrompt } from "./PluginPermissionPrompt";
import { AbilityDetailSheet } from "./detail/AbilityDetailSheet";

/**
 * 详情抽屉壳保持轻量同步加载；Markdown/Shiki 等重内容由抽屉内部按需加载。
 * 这样点击后可以立即提交抽屉和基础信息，不必等待完整详情代码。
 */

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

	const [detailMounted, setDetailMounted] = useState(detail !== undefined);
	// 关闭动画期间保留抽屉内容；只有 Vaul 报告退出动画完成后才卸载，
	// 这样关闭意图发生时可立即释放遮罩，同时不牺牲退出动画。
	useEffect(() => {
		if (detail !== undefined) setDetailMounted(true);
	}, [detail]);
	const shouldRenderDetail = detailMounted || detail !== undefined;

	return (
		<>
			<AbilitiesPageView model={model} />
			{shouldRenderDetail ? (
				<AbilityDetailSheet
					detailId={detail ?? null}
					model={model}
					onClose={closeDetail}
					onExited={() => {
						if (detail === undefined) setDetailMounted(false);
					}}
				/>
			) : null}
			<PluginPermissionPrompt model={model} />
			<McpSetupPrompt model={model} />
		</>
	);
}
