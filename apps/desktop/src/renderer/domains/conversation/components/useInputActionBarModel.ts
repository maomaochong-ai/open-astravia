import {
	activeInputActionIdsAtom,
	activeSessionAtom,
	activeToolNamesAtom,
	currentScenarioAtom,
	knowledgeBaseEnabledAtom,
	knowledgeRetrievalActiveAtom,
	persistInputActionStateForSession,
	pluginInputActionsAtom,
	type RegisteredInputAction,
} from "@shared/store/atoms";
import type { ConversationScenario } from "@vetta-org/plugin-sdk";
import { useAtom, useAtomValue } from "jotai";
import { type ReactNode, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
	BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID,
	recordInputActionToggled,
} from "../../../shared/lib/app-monitor-events";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { usePlanModeModel } from "../hooks/usePlanModeModel";

const KNOWLEDGE_TOOLS = ["kb_filter_by_tags", "kb_list_available_tags"];

export interface InputActionBarItem {
	active: boolean;
	icon?: ReactNode;
	id: string;
	label: string;
}

/** 宿主自带的输入动作：与插件动作同一份列表、同一种胶囊，只是开关由宿主自己实现。 */
export interface BuiltinInputAction {
	active: boolean;
	/** iconify class；尺寸由各展示位置自行决定。 */
	iconClass: string;
	id: string;
	label: string;
	onToggle: () => void;
}

export const BUILTIN_PLAN_MODE_ACTION_ID = "__builtin_plan_mode__";

export interface InputActionBarModel {
	actions: {
		toggleItem: (id: string) => void;
	};
	builtins: readonly BuiltinInputAction[];
	items: readonly InputActionBarItem[];
	visible: boolean;
}

function knowledgeVisible(activeTools: Set<string> | null): boolean {
	return activeTools === null || KNOWLEDGE_TOOLS.some((tool) => activeTools.has(tool));
}

/** 计划模式需要有人审批计划；新会话页（场景未定）也放行，由发送时落地。 */
function planModeVisible(scenario: ConversationScenario | null): boolean {
	return scenario === null || scenario === "conversation" || scenario === "project";
}

function actionVisible(
	action: RegisteredInputAction,
	activeTools: Set<string> | null,
	scenario: ConversationScenario | null,
): boolean {
	if (scenario === null || !action.scope_use?.includes(scenario)) return false;
	return activeTools === null || !action.requiresActiveTool || activeTools.has(action.requiresActiveTool);
}

export function useInputActionBarModel(): InputActionBarModel {
	const { t } = useTranslation("chat");
	const resolvePluginText = usePluginTextResolver();
	const allActions = useAtomValue(pluginInputActionsAtom);
	const [activeIds, setActiveIds] = useAtom(activeInputActionIdsAtom);
	const [knowledgeActive, setKnowledgeActive] = useAtom(knowledgeRetrievalActiveAtom);
	const knowledgeBaseEnabled = useAtomValue(knowledgeBaseEnabledAtom);
	const activeTools = useAtomValue(activeToolNamesAtom);
	const currentScenario = useAtomValue(currentScenarioAtom);
	const sessionPath = useAtomValue(activeSessionAtom)?.sessionPath || null;
	const planMode = usePlanModeModel();
	const showKnowledge = knowledgeBaseEnabled && knowledgeVisible(activeTools);
	const visibleActions = allActions.filter((action) => actionVisible(action, activeTools, currentScenario));

	const toggleItem = useCallback(
		(actionId: string) => {
			const action = allActions.find((candidate) => candidate.actionId === actionId);
			if (!action) return;

			const willActivate = !activeIds.has(actionId);
			if (willActivate && action.onToggle?.(true) === false) return;
			if (!willActivate) action.onToggle?.(false);
			const nextIds = new Set(activeIds);
			if (willActivate) nextIds.add(actionId);
			else nextIds.delete(actionId);
			setActiveIds(nextIds);
			if (sessionPath) {
				persistInputActionStateForSession(sessionPath, {
					actionIds: [...nextIds],
					knowledgeRetrieval: knowledgeActive,
				});
			}
			recordInputActionToggled("plugin", actionId, willActivate);
		},
		[activeIds, allActions, knowledgeActive, sessionPath, setActiveIds],
	);

	const toggleKnowledge = useCallback(() => {
		const willActivate = !knowledgeActive;
		setKnowledgeActive(willActivate);
		if (sessionPath) {
			persistInputActionStateForSession(sessionPath, {
				actionIds: [...activeIds],
				knowledgeRetrieval: willActivate,
			});
		}
		recordInputActionToggled("builtin", BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID, willActivate);
	}, [activeIds, knowledgeActive, sessionPath, setKnowledgeActive]);

	const builtins: BuiltinInputAction[] = [
		...(showKnowledge
			? [
					{
						id: BUILTIN_KNOWLEDGE_RETRIEVAL_ACTION_ID,
						label: t("inputActionBar.knowledgeRetrieval.label"),
						iconClass: "icon-[mdi--book-search-outline]",
						active: knowledgeActive,
						onToggle: toggleKnowledge,
					},
				]
			: []),
		...(planModeVisible(currentScenario)
			? [
					{
						id: BUILTIN_PLAN_MODE_ACTION_ID,
						label: t("inputActionBar.planMode.label"),
						iconClass: "icon-[solar--checklist-minimalistic-linear]",
						active: planMode.active,
						onToggle: planMode.onToggle,
					},
				]
			: []),
	];

	return {
		actions: { toggleItem },
		builtins,
		items: visibleActions.map((action) => ({
			active: activeIds.has(action.actionId),
			icon: action.icon,
			id: action.actionId,
			label: resolvePluginText(action.pluginId, action.label),
		})),
		visible: builtins.length > 0 || visibleActions.length > 0,
	};
}
