import type { Getter, Setter } from "jotai";
import { atom } from "jotai";
import type { TeamMemberModelPreference, TeamMemberModelSelection } from "../../../shared/agent-team-member-model";

export interface TeamMemberModelsState {
	readonly models?: Readonly<Record<string, TeamMemberModelPreference>>;
	readonly loading: boolean;
	readonly saving: boolean;
	readonly error?: string;
	readonly generation: number;
	readonly refreshRequested?: boolean;
}

export const teamMemberModelsAtom = atom<Readonly<Record<string, TeamMemberModelsState>>>({});

type ModelAction =
	| { readonly teamId: string; readonly kind: "load" }
	| {
			readonly teamId: string;
			readonly kind: "save";
			readonly memberId: string;
			readonly selection: TeamMemberModelSelection | null;
	  };

/** All entrances share the same saved preferences; stale reads cannot undo a newer edit. */
async function updateTeamMemberModels(get: Getter, set: Setter, action: ModelAction): Promise<void> {
	const { teamId } = action;
	const previous = get(teamMemberModelsAtom)[teamId];
	if (previous?.saving) {
		if (action.kind === "load")
			set(teamMemberModelsAtom, (states) => ({
				...states,
				[teamId]: { ...previous, refreshRequested: true },
			}));
		return;
	}
	const generation = (previous?.generation ?? 0) + 1;
	set(teamMemberModelsAtom, (states) => ({
		...states,
		[teamId]: {
			models: previous?.models,
			generation,
			loading: action.kind === "load",
			saving: action.kind === "save",
		},
	}));

	let refreshRequested = false;
	try {
		const models =
			action.kind === "load"
				? await window.vetta.agentTeams.listMemberModels(teamId)
				: await window.vetta.agentTeams.setMemberModel(teamId, action.memberId, action.selection);
		refreshRequested = get(teamMemberModelsAtom)[teamId]?.refreshRequested === true;
		set(teamMemberModelsAtom, (states) =>
			states[teamId]?.generation !== generation
				? states
				: {
						...states,
						[teamId]: { models, generation, loading: false, saving: false },
					},
		);
	} catch (cause) {
		set(teamMemberModelsAtom, (states) =>
			states[teamId]?.generation !== generation
				? states
				: {
						...states,
						[teamId]: {
							models: previous?.models,
							generation,
							loading: false,
							saving: false,
							error: cause instanceof Error ? cause.message : String(cause),
						},
					},
		);
	}
	if (refreshRequested) await updateTeamMemberModels(get, set, { kind: "load", teamId });
}

export const updateTeamMemberModelsAtom = atom(null, updateTeamMemberModels);
