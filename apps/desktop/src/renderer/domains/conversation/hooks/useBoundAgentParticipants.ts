import { useAgentAvatarResolver } from "@shared/agent-teams/agent-avatar";
import { type ConversationParticipantViewModel, DEFAULT_AGENT_PARTICIPANT_ID } from "@shared/conversation";
import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

/**
 * 会话绑定了单个 Agent 时，把它折成消息列表的参与者名单。
 *
 * 普通会话只有一个 Agent 作者（{@link DEFAULT_AGENT_PARTICIPANT_ID}），因此名单最多一人；
 * MessageListView 按 authorId 对号入座后，回合头像与昵称就换成该 Agent 的，
 * 未绑定时返回 undefined，渲染回落到通用机器人头像。
 */
export function useBoundAgentParticipants(): readonly ConversationParticipantViewModel[] | undefined {
	const activeSession = useAtomValue(activeSessionAtom);
	const agentProfileId = activeSession?.agentProfileId;
	const [participants, setParticipants] = useState<readonly ConversationParticipantViewModel[]>();
	const resolveAvatar = useAgentAvatarResolver();

	useEffect(() => {
		if (!agentProfileId) {
			setParticipants(undefined);
			return;
		}
		let cancelled = false;
		void window.vetta.agentTeams
			.list()
			.then((document) => {
				if (cancelled) return;
				const profile = document.agents.find((candidate) => candidate.id === agentProfileId);
				// Agent 被删后主进程会把会话降级为普通对话，这里同样回落到通用头像。
				if (!profile) {
					setParticipants(undefined);
					return;
				}
				setParticipants([
					{
						id: DEFAULT_AGENT_PARTICIPANT_ID,
						kind: "agent",
						name: profile.name,
						avatar: resolveAvatar(profile),
						blueprintId: profile.blueprintId,
					},
				]);
			})
			.catch(() => {
				if (!cancelled) setParticipants(undefined);
			});
		return () => {
			cancelled = true;
		};
	}, [agentProfileId, resolveAvatar]);

	return participants;
}
