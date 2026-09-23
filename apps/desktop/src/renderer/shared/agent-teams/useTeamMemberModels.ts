import { teamMemberModelsAtom, updateTeamMemberModelsAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import type { TeamMemberModelSelection } from "../../../shared/agent-team-member-model";

export function useTeamMemberModels(teamId: string, enabled = true) {
	const states = useAtomValue(teamMemberModelsAtom);
	const update = useSetAtom(updateTeamMemberModelsAtom);
	const reload = useCallback(() => update({ teamId, kind: "load" }), [teamId, update]);
	useEffect(() => {
		if (!enabled) return;
		void reload();
		const unsubscribeConfiguration = window.vetta.agentTeams.onChanged(() => {
			void reload();
		});
		const unsubscribeModels = window.vetta.agentTeams.onMemberModelsChanged((changedTeamId) => {
			if (changedTeamId === teamId) void reload();
		});
		return () => {
			unsubscribeConfiguration();
			unsubscribeModels();
		};
	}, [enabled, reload, teamId]);
	const select = useCallback(
		(memberId: string, selection: TeamMemberModelSelection | null) =>
			update({ teamId, kind: "save", memberId, selection }),
		[teamId, update],
	);
	return { state: states[teamId], reload, select };
}
