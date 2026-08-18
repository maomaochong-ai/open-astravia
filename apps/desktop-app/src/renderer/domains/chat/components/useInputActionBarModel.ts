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

const KNOWLEDGE_TOOLS = ["kb_filter_by_tags", "kb_list_available_tags"];

export interface InputActionBarItem {
	active: boolean;
	icon?: ReactNode;
	id: string;
	label: string;
}

export interface InputActionBarModel {
	actions: {
		toggleItem: (id: string) => void;
		toggleKnowledge: () => void;
	};
	items: readonly InputActionBarItem[];
	knowledge: {
		active: boolean;
		label: string;
		tooltip: string;
	} | null;
	visible: boolean;
}

function knowledgeVisible(activeTools: Set<string> | null): boolean {
	return activeTools === null || KNOWLEDGE_TOOLS.some((tool) => activeTools.has(tool));
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

	return {
		actions: {
			toggleItem,
			toggleKnowledge,
		},
		items: visibleActions.map((action) => ({
			active: activeIds.has(action.actionId),
			icon: action.icon,
			id: action.actionId,
			label: resolvePluginText(action.pluginId, action.label),
		})),
		knowledge: showKnowledge
			? {
					active: knowledgeActive,
					label: t("inputActionBar.knowledgeRetrieval.label"),
					tooltip: t("inputActionBar.knowledgeRetrieval.tooltip"),
				}
			: null,
		visible: showKnowledge || visibleActions.length > 0,
	};
}
