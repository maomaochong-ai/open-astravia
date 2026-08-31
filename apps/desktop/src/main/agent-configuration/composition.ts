import { join } from "node:path";
import { getAgentDir } from "@vetta/coding-agent/config";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { DesktopAgentConfigurationController } from "./agent-configuration-controller.js";
import { AgentTemplateRepository } from "./template-repository.js";

let controller: DesktopAgentConfigurationController | undefined;
export function getAgentConfigurationController(): DesktopAgentConfigurationController {
	controller ??= new DesktopAgentConfigurationController(
		new AgentTemplateRepository(join(getAgentDir(), "agent-templates.json")),
		getSharedRuntime,
		getAppLogger("agent-configuration"),
	);
	return controller;
}
