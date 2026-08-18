import type { ActivityTabDefinition } from "../registry/types";
import { backgroundTasksTabDefinition } from "./background-tasks-tab";
import { batchProgressTabDefinition } from "./batch-progress-tab";
import { browserTabDefinition } from "./browser-tab";
import { debugTabDefinition } from "./debug-tab";
import { fileTabDefinition } from "./file-tab";
import { knowledgeHistoryTabDefinition } from "./knowledge-history-tab";
import { todoTabDefinition } from "./todo-tab";
import { workflowTabDefinition } from "./workflow-tab";

/**
 * 内置活动面板 tab 注册表（顺序 = 默认自然序的次要键；主序看 definition.order）。
 * 新增内置 tab：在本目录加 definition 并 push 到此数组，无需改 model/view。
 */
export const BUILTIN_ACTIVITY_TABS: readonly ActivityTabDefinition[] = [
	fileTabDefinition,
	batchProgressTabDefinition,
	browserTabDefinition,
	todoTabDefinition,
	backgroundTasksTabDefinition,
	workflowTabDefinition,
	debugTabDefinition,
	knowledgeHistoryTabDefinition,
];
