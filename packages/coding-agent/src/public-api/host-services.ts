/**
 * Coding Agent 的宿主侧状态服务适配器。
 *
 * Runtime 只通过窄 Port 消费这些资源；Desktop Composition Root
 * 可以在进程边界创建并持有具体实现。
 */
import type { RuntimeSharedModelController } from "@vetta/runtime-core";
import {
	CodingAgentSharedModelController,
	type CodingAgentSharedModelSource,
} from "../adapters/runtime-core/shared-model-controller.js";
import { AuthStorage, type CodingAgentAuthRuntime, createCodingAgentAuthRuntime } from "../auth/index.js";
import { type CodingAgentHtmlExportRuntime, createCodingAgentHtmlExportRuntime } from "../export-html/index.js";
import { createCodingAgentHostFromSessionFactory } from "../host/coding-agent-host.js";
import { createHostBashExecutor } from "../host/command-execution/index.js";
import { createCodingAgentSessionFromPublicOptions } from "../host/sdk-session/index.js";
import {
	type CodingAgentMcpRuntimeToolSourceOptions,
	createCodingAgentMcpRuntimeToolSource,
} from "../mcp/runtime/tool-source.js";
import { type CodingAgentModelRuntime, createCodingAgentModelRuntime } from "../models/index.js";
import {
	type CodingAgentPluginMcpCompositionOptions,
	type CodingAgentPluginMcpRuntimeOptions,
	type CodingAgentPluginMcpToolSurface,
	createCodingAgentPluginMcpRuntime,
} from "../plugins/runtime/mcp-runtime.js";
import type { CodingAgentPluginRuntimeSource, CodingAgentRuntimeModelSource } from "../runtime-contracts/index.js";
import { SettingsRuntime } from "../settings/index.js";
import type { CodingAgentHost, CodingAgentHostSessionDefaults } from "./sdk/index.js";

export {
	AuthStorage,
	createCodingAgentAuthRuntime,
	createCodingAgentHtmlExportRuntime,
	createCodingAgentMcpRuntimeToolSource,
	createCodingAgentModelRuntime,
	createCodingAgentPluginMcpRuntime,
	createHostBashExecutor,
	SettingsRuntime,
};
export type { HostBashExecutor } from "../host/command-execution/index.js";
export type {
	CodingAgentAuthRuntime,
	CodingAgentHtmlExportRuntime,
	CodingAgentMcpRuntimeToolSourceOptions,
	CodingAgentModelRuntime,
	CodingAgentPluginMcpCompositionOptions,
	CodingAgentPluginMcpRuntimeOptions,
	CodingAgentPluginMcpToolSurface,
	CodingAgentPluginRuntimeSource,
	CodingAgentRuntimeModelSource,
	CodingAgentSharedModelSource,
};

export function createCodingAgentSharedModelController(
	models: CodingAgentSharedModelSource,
): RuntimeSharedModelController {
	return new CodingAgentSharedModelController(models);
}

export interface CreateCodingAgentHostWithServicesOptions {
	readonly authStorage?: CodingAgentAuthRuntime;
	readonly htmlExporter?: CodingAgentHtmlExportRuntime;
	readonly modelRuntime?: CodingAgentModelRuntime;
	readonly settings?: SettingsRuntime;
	readonly sessionDefaults?: CodingAgentHostSessionDefaults;
}

/**
 * 将现有宿主状态服务适配到稳定 Host；传入的服务由调用方持有，关闭 Host 不会销毁这些共享对象。
 */
export function createCodingAgentHostWithServices(
	options: CreateCodingAgentHostWithServicesOptions = {},
): CodingAgentHost {
	return createCodingAgentHostFromSessionFactory(
		{ sessionDefaults: options.sessionDefaults },
		(sessionOptions, lifecycle) =>
			createCodingAgentSessionFromPublicOptions(sessionOptions, {
				authStorage: options.authStorage,
				htmlExporter: options.htmlExporter,
				modelRegistry: options.modelRuntime,
				settingsManager: options.settings,
				onSessionClosed: lifecycle.onClosed,
			}),
	);
}
