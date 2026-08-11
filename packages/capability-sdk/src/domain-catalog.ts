import { createCapabilityCatalog } from "./catalog.js";
import { DOMAIN_AGENT_SETTINGS_CAPABILITIES } from "./domain/agent-settings.js";
import { DOMAIN_AI_CAPABILITIES } from "./domain/ai.js";
import { DOMAIN_BATCH_TASK_CAPABILITIES } from "./domain/batch-task.js";
import { DOMAIN_DOWNLOAD_CAPABILITIES } from "./domain/download.js";
import { DOMAIN_GENERAL_SETTINGS_CAPABILITIES } from "./domain/general-settings.js";
import { DOMAIN_IM_CAPABILITIES } from "./domain/im.js";
import { DOMAIN_KNOWLEDGE_CAPABILITIES } from "./domain/knowledge.js";
import { DOMAIN_MCP_CAPABILITIES } from "./domain/mcp.js";
import { DOMAIN_MEDIA_CAPABILITIES } from "./domain/media.js";
import { DOMAIN_MODEL_CAPABILITIES } from "./domain/model.js";
import { DOMAIN_NAVIGATION_CAPABILITIES } from "./domain/navigation.js";
import { DOMAIN_PROJECT_CAPABILITIES } from "./domain/project.js";
import { DOMAIN_SCHEDULER_CAPABILITIES } from "./domain/scheduler.js";
import { DOMAIN_SESSION_CAPABILITIES } from "./domain/session.js";
import { DOMAIN_QUICK_PANEL_CAPABILITIES, DOMAIN_SHORTCUT_CAPABILITIES } from "./domain/shortcut.js";
import { DOMAIN_SKILL_CAPABILITIES } from "./domain/skill.js";
import { DOMAIN_UPDATER_CAPABILITIES } from "./domain/updater.js";
import { DOMAIN_WEBHOOK_CAPABILITIES } from "./domain/webhook.js";

export const DOMAIN_CAPABILITY_CATALOG = createCapabilityCatalog([
	...Object.values(DOMAIN_AGENT_SETTINGS_CAPABILITIES),
	...Object.values(DOMAIN_AI_CAPABILITIES),
	...Object.values(DOMAIN_BATCH_TASK_CAPABILITIES),
	...Object.values(DOMAIN_DOWNLOAD_CAPABILITIES),
	...Object.values(DOMAIN_GENERAL_SETTINGS_CAPABILITIES),
	...Object.values(DOMAIN_IM_CAPABILITIES),
	...Object.values(DOMAIN_KNOWLEDGE_CAPABILITIES),
	...Object.values(DOMAIN_MCP_CAPABILITIES),
	...Object.values(DOMAIN_MEDIA_CAPABILITIES),
	...Object.values(DOMAIN_MODEL_CAPABILITIES),
	...Object.values(DOMAIN_NAVIGATION_CAPABILITIES),
	...Object.values(DOMAIN_PROJECT_CAPABILITIES),
	...Object.values(DOMAIN_SCHEDULER_CAPABILITIES),
	...Object.values(DOMAIN_SESSION_CAPABILITIES),
	...Object.values(DOMAIN_SHORTCUT_CAPABILITIES),
	...Object.values(DOMAIN_QUICK_PANEL_CAPABILITIES),
	...Object.values(DOMAIN_SKILL_CAPABILITIES),
	...Object.values(DOMAIN_UPDATER_CAPABILITIES),
	...Object.values(DOMAIN_WEBHOOK_CAPABILITIES),
]);
