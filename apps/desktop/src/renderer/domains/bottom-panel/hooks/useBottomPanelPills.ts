import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { InputBarBottomPanelPillsModel } from "../../conversation/components/input-bar/types";
import { bottomPanelMetaMapAtom } from "../registry/instance-atoms";
import { resolveBottomPanelPills } from "../registry/resolve-bottom-panel-tabs";
import { useBottomPanelModel } from "./useBottomPanelModel";

/**
 * 面板缩起时给输入栏下沿用的 pill 数据。
 *
 * 只给数据不给节点：输入栏的 view model 里放 ReactNode 会把 UI 边界糊掉，
 * 而 pill 的视觉本来就该由 theme-ui 的 `BottomPanelPillsView` 统一提供。
 * 展开态的 tab 与这里读同一份 meta，两种形态的名字和状态点永远一致。
 */
export function useBottomPanelPills(scope: WorkSurfaceScope | null): InputBarBottomPanelPillsModel | null {
	const { t } = useTranslation("chat");
	const model = useBottomPanelModel(scope ?? { key: "bottom-panel:unbound", cwd: null }, Boolean(scope));
	const metaById = useAtomValue(bottomPanelMetaMapAtom);

	const pills = useMemo(() => {
		if (!scope || !model.state.collapsed || !model.state.root) return [];
		return resolveBottomPanelPills(model.state, model.definitions, metaById);
	}, [model, metaById, scope]);

	if (!scope || pills.length === 0) return null;
	return { pills, groupLabel: t("bottomPanel.pillsGroup"), onSelect: model.expandAndActivate };
}
