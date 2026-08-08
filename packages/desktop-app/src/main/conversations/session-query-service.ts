import type { ProjectInfo } from "@vetta/runtime-core";
import type { DesktopSessionHistoryInfo } from "../../shared/session-access.js";
import { allowProjectRoot } from "../filesystem/filesystem-service.js";
import { getSharedRuntime } from "../runtime.js";
import { getDesktopConversationService } from "./desktop-conversation-service.js";

export async function listRuntimeSessionProjects(): Promise<ProjectInfo[]> {
	const projects = await getSharedRuntime().listProjects();
	for (const project of projects) allowProjectRoot(project.cwd);
	return projects;
}

export function listSessionHistory(cwd: string): Promise<DesktopSessionHistoryInfo[]> {
	return getDesktopConversationService().listSessions(cwd);
}
