import { stat } from "node:fs/promises";
import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import {
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type Disposable,
	DOMAIN_AGENT_SETTINGS_CAPABILITIES,
	DOMAIN_BATCH_TASK_CAPABILITIES,
	DOMAIN_DOWNLOAD_CAPABILITIES,
	DOMAIN_GENERAL_SETTINGS_CAPABILITIES,
	DOMAIN_IM_CAPABILITIES,
	DOMAIN_KNOWLEDGE_CAPABILITIES,
	DOMAIN_PROJECT_CAPABILITIES,
	DOMAIN_QUICK_PANEL_CAPABILITIES,
	DOMAIN_SCHEDULER_CAPABILITIES,
	DOMAIN_SESSION_CAPABILITIES,
	DOMAIN_SHORTCUT_CAPABILITIES,
	DOMAIN_SKILL_CAPABILITIES,
	DOMAIN_UPDATER_CAPABILITIES,
	DOMAIN_WEBHOOK_CAPABILITIES,
} from "@vetta/capability-sdk";
import { getDesktopAgentSettingsService } from "../agent-settings/agent-settings-service.js";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import { getDesktopBatchTaskService } from "../batch-tasks/batch-task-service.js";
import { readDesktopConfig, writeDesktopConfig } from "../config/desktop-config-store.js";
import { listRuntimeSessionProjects, listSessionHistory } from "../conversations/session-query-service.js";
import { getDesktopDownloadService } from "../downloads/download-service.js";
import { allowProjectRoot, createFilesystemDirectory } from "../filesystem/filesystem-service.js";
import { getDesktopGeneralSettingsService } from "../general-settings/general-settings-service.js";
import { getImHost } from "../im-host/index.js";
import type { JobManager } from "../jobs/job-manager.js";
import { getKnowledgeService } from "../knowledge/knowledge-service.js";
import { broadcastProjectsChanged } from "../projects/project-events.js";
import { ProjectService } from "../projects/project-service.js";
import { getDesktopSchedulerService } from "../scheduler/scheduler-service.js";
import { getDesktopShortcutService } from "../shortcuts/shortcut-service.js";
import { getDesktopSkillService } from "../skills/skill-service.js";
import { getAppVersion, updaterService } from "../updater.js";
import { getWebhookManager } from "../webhook/index.js";
import { registerDesktopAiProviders } from "./ai-providers.js";
import { registerDesktopMcpProviders } from "./mcp-providers.js";
import { registerDesktopMediaProviders } from "./media-providers.js";
import { registerDesktopModelProviders } from "./model-providers.js";

const DOMAIN_BATCH_TASK_PROVIDER_OWNER = "vetta.domain.batch-task";
const DOMAIN_AGENT_SETTINGS_PROVIDER_OWNER = "vetta.domain.agent-settings";
const DOMAIN_GENERAL_SETTINGS_PROVIDER_OWNER = "vetta.domain.general-settings";
const DOMAIN_IM_PROVIDER_OWNER = "vetta.domain.im";
const DOMAIN_PROJECT_PROVIDER_OWNER = "vetta.domain.project";
const DOMAIN_SESSION_PROVIDER_OWNER = "vetta.domain.session";
const DOMAIN_SKILL_PROVIDER_OWNER = "vetta.domain.skill";
const DOMAIN_SHORTCUT_PROVIDER_OWNER = "vetta.domain.shortcut";
const DOMAIN_QUICK_PANEL_PROVIDER_OWNER = "vetta.domain.quick-panel";
const DOMAIN_DOWNLOAD_PROVIDER_OWNER = "vetta.domain.download";
const DOMAIN_UPDATER_PROVIDER_OWNER = "vetta.domain.updater";
const DOMAIN_KNOWLEDGE_PROVIDER_OWNER = "vetta.domain.knowledge";
const DOMAIN_SCHEDULER_PROVIDER_OWNER = "vetta.domain.scheduler";
const DOMAIN_WEBHOOK_PROVIDER_OWNER = "vetta.domain.webhook";

function assertNotAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "Capability invocation was aborted");
	}
}

export function registerDesktopDomainProviders(
	registry: CapabilityRegistry,
	artifacts: ArtifactStore,
	jobs: JobManager,
): Disposable {
	const agentSettings = getDesktopAgentSettingsService();
	const batchTasks = getDesktopBatchTaskService();
	const downloads = getDesktopDownloadService();
	const generalSettings = getDesktopGeneralSettingsService();
	const im = getImHost();
	const knowledge = getKnowledgeService();
	const scheduler = getDesktopSchedulerService();
	const shortcuts = getDesktopShortcutService();
	const skills = getDesktopSkillService();
	const webhooks = getWebhookManager();
	const aiRegistration = registerDesktopAiProviders(registry);
	const mcpRegistration = registerDesktopMcpProviders(registry);
	const mediaRegistration = registerDesktopMediaProviders(registry, artifacts, jobs);
	const modelRegistration = registerDesktopModelProviders(registry);
	const projects = new ProjectService({
		allowProjectRoot,
		createDirectory: createFilesystemDirectory,
		readConfig: readDesktopConfig,
		writeConfig: writeDesktopConfig,
		broadcastChanged: broadcastProjectsChanged,
		// 直接查磁盘：这是「能不能登记成项目」的判断，此刻该路径还不在任何授权根里，
		// 走不了 filesystem-service 那套带 allowedRoots 断言的入口。
		isExistingNonDirectory: async (path) => {
			try {
				return !(await stat(path)).isDirectory();
			} catch {
				// 不存在（或读不到）不算「非目录」：open 本来就允许登记一个还没建出来的目录。
				return false;
			}
		},
	});
	const projectRegistration = registry.registerOwner(DOMAIN_PROJECT_PROVIDER_OWNER, [
		bindCapability(DOMAIN_PROJECT_CAPABILITIES.LIST, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return projects.list();
			},
		}),
		bindCapability(DOMAIN_PROJECT_CAPABILITIES.CREATE, {
			execute: async ({ name, path }, context) => {
				assertNotAborted(context.signal);
				return projects.create(name, path);
			},
		}),
		bindCapability(DOMAIN_PROJECT_CAPABILITIES.OPEN, {
			execute: async ({ path, name }, context) => {
				assertNotAborted(context.signal);
				return projects.open(path, name);
			},
		}),
		bindCapability(DOMAIN_PROJECT_CAPABILITIES.RENAME, {
			execute: async ({ path, name }, context) => {
				assertNotAborted(context.signal);
				return projects.rename(path, name);
			},
		}),
		bindCapability(DOMAIN_PROJECT_CAPABILITIES.ARCHIVE, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await projects.archive(path);
			},
		}),
		bindCapability(DOMAIN_PROJECT_CAPABILITIES.UNARCHIVE, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await projects.unarchive(path);
			},
		}),
		bindCapability(DOMAIN_PROJECT_CAPABILITIES.REMOVE, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await projects.remove(path);
			},
		}),
	]);
	const agentSettingsRegistration = registry.registerOwner(DOMAIN_AGENT_SETTINGS_PROVIDER_OWNER, [
		bindCapability(DOMAIN_AGENT_SETTINGS_CAPABILITIES.GET_EXPERIMENTAL, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return agentSettings.getExperimental();
			},
		}),
		bindCapability(DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_EXPERIMENTAL, {
			execute: async (input, context) => {
				assertNotAborted(context.signal);
				return agentSettings.setExperimental(input);
			},
		}),
	]);
	const generalSettingsRegistration = registry.registerOwner(DOMAIN_GENERAL_SETTINGS_PROVIDER_OWNER, [
		bindCapability(DOMAIN_GENERAL_SETTINGS_CAPABILITIES.GET, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return generalSettings.getSettings();
			},
		}),
		bindCapability(DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_NOTIFICATIONS, {
			execute: async ({ enabled }, context) => {
				assertNotAborted(context.signal);
				return generalSettings.setNotifications(enabled);
			},
		}),
		bindCapability(DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_DEFAULT_EXECUTION_MODE, {
			execute: async ({ mode }, context) => {
				assertNotAborted(context.signal);
				return generalSettings.setDefaultExecutionMode(mode);
			},
		}),
		bindCapability(DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_WORKSPACE, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				return generalSettings.setWorkspace(path);
			},
		}),
	]);
	const imRegistration = registry.registerOwner(DOMAIN_IM_PROVIDER_OWNER, [
		bindCapability(DOMAIN_IM_CAPABILITIES.GET_STATUS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				const config = im.getPublicConfig();
				return {
					enabled: config.enabled,
					transport: config.transport,
					agentModel: config.agentModel ?? null,
					wechatBound: config.wechat.bound,
					feishuAppId: config.feishu.appId || null,
					runtime: im.getStatus(),
				};
			},
		}),
		bindCapability(DOMAIN_IM_CAPABILITIES.LIST_LOGS, {
			execute: async ({ limit }, context) => {
				assertNotAborted(context.signal);
				return im
					.getRecentLogs()
					.slice(-limit)
					.map(({ level, msg, time, fields }) => ({
						level,
						msg,
						time,
						...(fields === undefined ? {} : { fields: { ...fields } }),
					}));
			},
		}),
		bindCapability(DOMAIN_IM_CAPABILITIES.SET_ENABLED, {
			execute: async ({ enabled }, context) => {
				assertNotAborted(context.signal);
				const result = await im.setConfig({ enabled });
				if (!result.ok) throw new Error(result.error ?? "Failed to update IM config");
				return im.getStatus();
			},
		}),
		bindCapability(DOMAIN_IM_CAPABILITIES.RESTART, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				await im.restart();
				return im.getStatus();
			},
		}),
		bindCapability(DOMAIN_IM_CAPABILITIES.SET_AGENT_MODEL, {
			execute: async ({ agentModel }, context) => {
				assertNotAborted(context.signal);
				const config = im.getPublicConfig();
				const result = await im.setConfig({ enabled: config.enabled, agentModel });
				if (!result.ok) throw new Error(result.error ?? "Failed to set IM agent model");
				return im.getStatus();
			},
		}),
	]);
	const batchTaskRegistration = registry.registerOwner(DOMAIN_BATCH_TASK_PROVIDER_OWNER, [
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.LIST_PROJECTS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return batchTasks.listProjects();
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.GET_PROJECT, {
			execute: async ({ projectId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.getProject(projectId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.CREATE_PROJECT, {
			execute: async ({ data }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.createProject({ ...data });
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.UPDATE_PROJECT, {
			execute: async ({ projectId, data }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.updateProject(projectId, { ...data });
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.DELETE_PROJECT, {
			execute: async ({ projectId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.deleteProject(projectId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.RUN_TASK, {
			execute: async ({ projectId, taskId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.runTask(projectId, taskId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.RETRY_TASK, {
			execute: async ({ projectId, taskId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.retryTask(projectId, taskId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.STOP_TASK, {
			execute: async ({ projectId, taskId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.stopTask(projectId, taskId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.DELETE_TASK, {
			execute: async ({ projectId, taskId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.deleteTask(projectId, taskId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.RESUME_TASK, {
			execute: async ({ projectId, taskId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.resumeTask(projectId, taskId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.RESUME_TASK_WITH_TEXT, {
			execute: async ({ projectId, taskId, text }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.resumeTask(projectId, taskId, text);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.DELETE_TASK_SESSION, {
			execute: async ({ projectId, taskId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.deleteTaskSession(projectId, taskId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.DELETE_ALL_TASKS, {
			execute: async ({ projectId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.deleteAllTasks(projectId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.START_PROJECT, {
			execute: async ({ projectId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.startProject(projectId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.STOP_PROJECT, {
			execute: async ({ projectId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.stopProject(projectId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.RESET_PROJECT, {
			execute: async ({ projectId }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.resetProject(projectId);
			},
		}),
		bindCapability(DOMAIN_BATCH_TASK_CAPABILITIES.RESET_FAILED_TASKS, {
			execute: async ({ projectId, taskIds }, context) => {
				assertNotAborted(context.signal);
				return batchTasks.resetFailedTasks(projectId, taskIds);
			},
		}),
	]);
	const sessionRegistration = registry.registerOwner(DOMAIN_SESSION_PROVIDER_OWNER, [
		bindCapability(DOMAIN_SESSION_CAPABILITIES.LIST, {
			execute: async ({ cwd }, context) => {
				assertNotAborted(context.signal);
				return listSessionHistory(cwd);
			},
		}),
		bindCapability(DOMAIN_SESSION_CAPABILITIES.LIST_RUNTIME_PROJECTS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return listRuntimeSessionProjects();
			},
		}),
	]);
	const skillRegistration = registry.registerOwner(DOMAIN_SKILL_PROVIDER_OWNER, [
		bindCapability(DOMAIN_SKILL_CAPABILITIES.LIST, {
			execute: async ({ cwd }, context) => {
				assertNotAborted(context.signal);
				return skills.list(cwd);
			},
		}),
		bindCapability(DOMAIN_SKILL_CAPABILITIES.LIST_INSTALLED, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return skills.getManifest();
			},
		}),
		bindCapability(DOMAIN_SKILL_CAPABILITIES.SET_ENABLED, {
			execute: async ({ name, enabled }, context) => {
				assertNotAborted(context.signal);
				return skills.setEnabled(name, enabled);
			},
		}),
		bindCapability(DOMAIN_SKILL_CAPABILITIES.UNINSTALL, {
			execute: async ({ name, type }, context) => {
				assertNotAborted(context.signal);
				await skills.uninstall(name, type);
			},
		}),
	]);
	const shortcutRegistration = registry.registerOwner(DOMAIN_SHORTCUT_PROVIDER_OWNER, [
		bindCapability(DOMAIN_SHORTCUT_CAPABILITIES.GET_SETTINGS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return shortcuts.getSettings();
			},
		}),
		bindCapability(DOMAIN_SHORTCUT_CAPABILITIES.SET_BINDING, {
			execute: async ({ id, shortcut }, context) => {
				assertNotAborted(context.signal);
				return shortcuts.setBinding(id, shortcut);
			},
		}),
		bindCapability(DOMAIN_SHORTCUT_CAPABILITIES.RESET_BINDING, {
			execute: async ({ id }, context) => {
				assertNotAborted(context.signal);
				return shortcuts.resetBinding(id);
			},
		}),
		bindCapability(DOMAIN_SHORTCUT_CAPABILITIES.RESET_ALL_BINDINGS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return shortcuts.resetAllBindings();
			},
		}),
	]);
	const quickPanelRegistration = registry.registerOwner(DOMAIN_QUICK_PANEL_PROVIDER_OWNER, [
		bindCapability(DOMAIN_QUICK_PANEL_CAPABILITIES.SET_TRIGGER, {
			execute: async ({ trigger }, context) => {
				assertNotAborted(context.signal);
				return shortcuts.setQuickPanelTrigger(trigger);
			},
		}),
		bindCapability(DOMAIN_QUICK_PANEL_CAPABILITIES.SET_POST_SEND_BEHAVIOR, {
			execute: async ({ behavior }, context) => {
				assertNotAborted(context.signal);
				return shortcuts.setQuickPanelPostSendBehavior(behavior);
			},
		}),
	]);
	const downloadRegistration = registry.registerOwner(DOMAIN_DOWNLOAD_PROVIDER_OWNER, [
		bindCapability(DOMAIN_DOWNLOAD_CAPABILITIES.LIST, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return downloads.list();
			},
		}),
		bindCapability(DOMAIN_DOWNLOAD_CAPABILITIES.CANCEL, {
			execute: async ({ id }, context) => {
				assertNotAborted(context.signal);
				downloads.cancel(id);
			},
		}),
	]);
	const updaterRegistration = registry.registerOwner(DOMAIN_UPDATER_PROVIDER_OWNER, [
		bindCapability(DOMAIN_UPDATER_CAPABILITIES.GET_STATE, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return updaterService.getState();
			},
		}),
		bindCapability(DOMAIN_UPDATER_CAPABILITIES.GET_CURRENT_VERSION, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return getAppVersion();
			},
		}),
		bindCapability(DOMAIN_UPDATER_CAPABILITIES.CHECK, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return updaterService.check();
			},
		}),
		bindCapability(DOMAIN_UPDATER_CAPABILITIES.DOWNLOAD, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return updaterService.startDownload();
			},
		}),
		bindCapability(DOMAIN_UPDATER_CAPABILITIES.INSTALL, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				await updaterService.install();
			},
		}),
		bindCapability(DOMAIN_UPDATER_CAPABILITIES.DISMISS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				updaterService.dismissReady();
			},
		}),
		bindCapability(DOMAIN_UPDATER_CAPABILITIES.CANCEL, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				updaterService.cancel();
			},
		}),
	]);
	const knowledgeRegistration = registry.registerOwner(DOMAIN_KNOWLEDGE_PROVIDER_OWNER, [
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_BASES, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return knowledge.listBases();
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_FILE_STATUSES, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return knowledge.listFileStatuses();
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.GET_PROCESSING_STATUS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return knowledge.isProcessing();
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.GET_PROCESSING_SETTINGS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return knowledge.getProcessing();
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.CREATE_BASE, {
			execute: async ({ name }, context) => {
				assertNotAborted(context.signal);
				await knowledge.createBase(name);
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.RENAME_BASE, {
			execute: async ({ name, newName }, context) => {
				assertNotAborted(context.signal);
				await knowledge.renameBase(name, newName);
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.DELETE_BASE, {
			execute: async ({ name }, context) => {
				assertNotAborted(context.signal);
				await knowledge.deleteBase(name);
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.ADD_FILES, {
			execute: async ({ kbId, paths, move }, context) => {
				assertNotAborted(context.signal);
				await knowledge.addFiles(kbId, paths, move);
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.DELETE_ENTRY, {
			execute: async ({ kbId, relPath }, context) => {
				assertNotAborted(context.signal);
				await knowledge.deleteEntry(kbId, relPath);
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.SCAN_NOW, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return knowledge.scanNow();
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.RETRY_FAILED, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return knowledge.retryFailed();
			},
		}),
		bindCapability(DOMAIN_KNOWLEDGE_CAPABILITIES.SET_PROCESSING_SETTINGS, {
			execute: async ({ data }, context) => {
				assertNotAborted(context.signal);
				return knowledge.setProcessing(data);
			},
		}),
	]);
	const schedulerRegistration = registry.registerOwner(DOMAIN_SCHEDULER_PROVIDER_OWNER, [
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.LIST_TASKS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return scheduler.listTasks();
			},
		}),
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.GET_TASK, {
			execute: async ({ taskId }, context) => {
				assertNotAborted(context.signal);
				return scheduler.getTask(taskId);
			},
		}),
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.LIST_HISTORY, {
			execute: async ({ taskId }, context) => {
				assertNotAborted(context.signal);
				return scheduler.getHistory(taskId);
			},
		}),
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.CREATE_TASK, {
			execute: async ({ data }, context) => {
				assertNotAborted(context.signal);
				return scheduler.createTask({ ...data });
			},
		}),
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.UPDATE_TASK, {
			execute: async ({ taskId, data }, context) => {
				assertNotAborted(context.signal);
				return scheduler.updateTask(taskId, { ...data });
			},
		}),
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.DELETE_TASK, {
			execute: async ({ taskId }, context) => {
				assertNotAborted(context.signal);
				return scheduler.deleteTask(taskId);
			},
		}),
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.SET_ENABLED, {
			execute: async ({ taskId, enabled }, context) => {
				assertNotAborted(context.signal);
				return scheduler.setEnabled(taskId, enabled);
			},
		}),
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.RUN_TASK, {
			execute: async ({ taskId }, context) => {
				assertNotAborted(context.signal);
				return scheduler.runNow(taskId);
			},
		}),
		bindCapability(DOMAIN_SCHEDULER_CAPABILITIES.ABORT_TASK, {
			execute: async ({ taskId }, context) => {
				assertNotAborted(context.signal);
				return scheduler.abort(taskId);
			},
		}),
	]);
	const webhookRegistration = registry.registerOwner(DOMAIN_WEBHOOK_PROVIDER_OWNER, [
		bindCapability(DOMAIN_WEBHOOK_CAPABILITIES.LIST_ENDPOINTS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return webhooks.list();
			},
		}),
		bindCapability(DOMAIN_WEBHOOK_CAPABILITIES.LIST_PROVIDERS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				return webhooks.listProviderDescriptors();
			},
		}),
		bindCapability(DOMAIN_WEBHOOK_CAPABILITIES.CREATE_ENDPOINT, {
			execute: async ({ data }, context) => {
				assertNotAborted(context.signal);
				return webhooks.create({ ...data });
			},
		}),
		bindCapability(DOMAIN_WEBHOOK_CAPABILITIES.UPDATE_ENDPOINT, {
			execute: async ({ id, data }, context) => {
				assertNotAborted(context.signal);
				return webhooks.update(id, { ...data });
			},
		}),
		bindCapability(DOMAIN_WEBHOOK_CAPABILITIES.DELETE_ENDPOINT, {
			execute: async ({ id }, context) => {
				assertNotAborted(context.signal);
				webhooks.delete(id);
			},
		}),
		bindCapability(DOMAIN_WEBHOOK_CAPABILITIES.SET_ENABLED, {
			execute: async ({ id, enabled }, context) => {
				assertNotAborted(context.signal);
				return webhooks.setEnabled(id, enabled);
			},
		}),
		bindCapability(DOMAIN_WEBHOOK_CAPABILITIES.TEST_ENDPOINT, {
			execute: async ({ id }, context) => {
				assertNotAborted(context.signal);
				return webhooks.test(id);
			},
		}),
		bindCapability(DOMAIN_WEBHOOK_CAPABILITIES.SEND_MESSAGE, {
			execute: async ({ id, message }, context) => {
				assertNotAborted(context.signal);
				return webhooks.send(id, { ...message });
			},
		}),
	]);
	return {
		dispose: () => {
			aiRegistration.dispose();
			mcpRegistration.dispose();
			mediaRegistration.dispose();
			modelRegistration.dispose();
			webhookRegistration.dispose();
			schedulerRegistration.dispose();
			knowledgeRegistration.dispose();
			updaterRegistration.dispose();
			downloadRegistration.dispose();
			batchTaskRegistration.dispose();
			quickPanelRegistration.dispose();
			shortcutRegistration.dispose();
			skillRegistration.dispose();
			sessionRegistration.dispose();
			projectRegistration.dispose();
			imRegistration.dispose();
			generalSettingsRegistration.dispose();
			agentSettingsRegistration.dispose();
		},
	};
}
