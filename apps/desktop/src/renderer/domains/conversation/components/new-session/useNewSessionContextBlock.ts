import { deriveSkillNames, parseInputSegments } from "@shared/lib/input-tokens";
import { inputValueAtom, promptAttachmentAtom } from "@shared/store/atoms";
import { pluginNewSessionContextsAtom } from "@shared/store/plugin-atoms";
import type { PluginNewSessionContext } from "@vetta-org/plugin-sdk";
import { useAtomValue, useSetAtom } from "jotai";
import type { ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { focusInputEditor, insertPlainText, prependPlainText } from "../input-bar/editor/inputEditorHandle";
import { useAgentTeamDirectoryDocument } from "./agent-team-directory";
import { type ActiveNewSessionContext, resolveNewSessionContexts } from "./new-session-context-activation";
import { parseAgentTargetKey, parseTeamTargetKey } from "./target";

export interface NewSessionContextBlockModel {
	readonly contexts: readonly ActiveNewSessionContext[];
	readonly renderContext: (context: ActiveNewSessionContext) => ReactNode;
}

export interface UseNewSessionContextBlockInput {
	readonly targetKey: string | null;
	readonly cwd: string | null;
}

/**
 * 组装新会话上下文区：裁决哪些插件贡献上屏，并为它们准备渲染上下文。
 *
 * 草稿逐字符变化会重算激活，但只有「提到的本插件能力」这一条依赖它，命中集合通常不变，
 * 所以 memo 的输入刻意收敛到名字数组而不是原始文本。
 */
export function useNewSessionContextBlock(input: UseNewSessionContextBlockInput): NewSessionContextBlockModel {
	const contributions = useAtomValue(pluginNewSessionContextsAtom);
	const document = useAgentTeamDirectoryDocument();
	const draft = useAtomValue(inputValueAtom);
	const setPromptAttachment = useSetAtom(promptAttachmentAtom);

	const { skills, mcpServers } = useMemo(() => parseMentionedAbilities(draft), [draft]);

	const target = useMemo(() => {
		if (!document) return {};
		const agentId = parseAgentTargetKey(input.targetKey);
		if (agentId) return { targetAgent: document.agents.find((agent) => agent.id === agentId) };
		const teamId = parseTeamTargetKey(input.targetKey);
		if (teamId) return { targetTeam: document.teams.find((team) => team.id === teamId) };
		return {};
	}, [document, input.targetKey]);

	const agentsById = useMemo(() => new Map((document?.agents ?? []).map((agent) => [agent.id, agent])), [document]);

	const contexts = useMemo(
		() =>
			resolveNewSessionContexts({
				contributions,
				...target,
				agentsById,
				mentionedSkills: skills,
				mentionedMcpServers: mcpServers,
			}),
		[contributions, target, agentsById, skills, mcpServers],
	);

	const renderContext = useCallback(
		(active: ActiveNewSessionContext): ReactNode => {
			const context: PluginNewSessionContext = {
				target: target.targetAgent
					? {
							kind: "agent",
							id: target.targetAgent.id,
							...(active.targetContributedId ? { contributedId: active.targetContributedId } : {}),
						}
					: target.targetTeam
						? {
								kind: "team",
								id: target.targetTeam.id,
								...(active.targetContributedId ? { contributedId: active.targetContributedId } : {}),
							}
						: null,
				mentionedAbilities: { skills: active.mentionedSkills, mcpServers: active.mentionedMcpServers },
				// 未授予 conversation.draft.read 就拿不到草稿，而不是拿到一份删节版。
				draft: active.contribution.canReadDraft ? draft : "",
				cwd: input.cwd,
				composer: {
					attach: (attachment) =>
						setPromptAttachment({
							...attachment,
							ownerPluginId: active.contribution.pluginId,
							...(active.contribution.pluginIconUrl
								? { ownerPluginIconUrl: active.contribution.pluginIconUrl }
								: {}),
						}),
					insertText: (text, options) => {
						if (options?.position === "start") prependPlainText(text);
						else insertPlainText(text);
						// 插完把焦点交还输入框：用户接着要补细节，不该再点一次。
						focusInputEditor();
					},
				},
			};
			return active.contribution.render(context);
		},
		[target, draft, input.cwd, setPromptAttachment],
	);

	return { contexts, renderContext };
}

/** 输入框里的能力以 token 形式存在（`@skill:` / `@mcp:`），按既有解析器取名字。 */
function parseMentionedAbilities(draft: string): { readonly skills: string[]; readonly mcpServers: string[] } {
	if (!draft.includes("@")) return { skills: [], mcpServers: [] };
	const { segments } = parseInputSegments(draft);
	const mcpServers: string[] = [];
	for (const segment of segments) {
		if (segment.kind === "connector" && !mcpServers.includes(segment.name)) mcpServers.push(segment.name);
	}
	return { skills: deriveSkillNames(segments), mcpServers };
}
