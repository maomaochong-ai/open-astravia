import type { AgentProfile } from "@vetta/agent-team";
import { useCallback, useEffect, useState } from "react";
import { agentAvatarUrl } from "../../../shared/agent-team-avatar";

export { AGENT_AVATAR_OPTIONS, agentAvatarUrl, teamMemberAvatarUrls } from "../../../shared/agent-team-avatar";

/** 档案里够用来定头像的部分：用户选过的图优先，其次按 blueprint 取提供方的图。 */
type AvatarSubject = Pick<AgentProfile, "id" | "blueprintId"> & { readonly avatar?: string };

/**
 * 按 blueprint 解析头像的函数。
 *
 * 头像随人设走，而人设由提供方维护，所以它既不在宿主里按角色写死，也不复制进用户档案
 * （那会让提供方换图之后所有人停在旧图上）。每个要画头像的界面拿这个解析器现算。
 */
export function useAgentAvatarResolver(): (subject: AvatarSubject) => string {
	const [avatarsByBlueprintId, setAvatars] = useState<ReadonlyMap<string, string>>(() => new Map());

	useEffect(() => {
		let active = true;
		// 组件测试里没有 preload 桥；拿不到就用兜底头像，不该让组件渲染不出来。
		const blueprints = window.vetta?.agentTeams?.listBlueprints?.();
		if (!blueprints) return;
		void blueprints
			.then((resolved) => {
				if (!active) return;
				setAvatars(
					new Map(
						resolved
							.filter((blueprint) => blueprint.avatarUrl)
							.map((blueprint) => [blueprint.id, blueprint.avatarUrl!] as const),
					),
				);
			})
			// 取不到就只是回落到兜底头像，不该打断调用方的渲染。
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, []);

	return useCallback(
		(subject: AvatarSubject) => agentAvatarUrl(subject, { avatarUrl: avatarsByBlueprintId.get(subject.blueprintId) }),
		[avatarsByBlueprintId],
	);
}
