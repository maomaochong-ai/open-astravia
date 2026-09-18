import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { TeamDefinition } from "@vetta/agent-team";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { z } from "zod";
import type { TeamMemberModelPreference, TeamMemberModelSelection } from "../../shared/agent-team-member-model.js";

export type { TeamMemberModelPreference, TeamMemberModelSelection } from "../../shared/agent-team-member-model.js";

const PreferenceSchema = z
	.object({
		agentProfileId: z.string().min(1),
		modelKey: z
			.string()
			.trim()
			.min(3)
			.max(512)
			.regex(/^[^/\s]+\/\S+$/),
		reasoning: z.string().min(1).max(64).optional(),
	})
	.strict();
const DocumentSchema = z
	.object({
		version: z.literal(1),
		teams: z.record(z.string(), z.record(z.string(), PreferenceSchema)),
	})
	.strict();

export function parseTeamMemberModelSelection(value: unknown): TeamMemberModelSelection | null {
	if (value === null) return null;
	return PreferenceSchema.omit({ agentProfileId: true }).parse(value);
}

/** User-owned overrides live outside plugin-owned Team definitions. */
export class TeamMemberModelPreferences {
	private document: z.infer<typeof DocumentSchema> | undefined;
	private loading: Promise<z.infer<typeof DocumentSchema>> | undefined;
	private mutationTail: Promise<unknown> = Promise.resolve();

	constructor(private readonly path = join(getVettaHomePath(), "agent-teams", "member-model-preferences.json")) {}

	async list(team: TeamDefinition): Promise<Readonly<Record<string, TeamMemberModelPreference>>> {
		const document = await this.read();
		const stored = document.teams[team.id] ?? {};
		return Object.fromEntries(
			team.members.flatMap((member) => {
				const preference = stored[member.id];
				return preference?.agentProfileId === member.binding.agentProfileId ? [[member.id, preference]] : [];
			}),
		);
	}

	async get(teamId: string, memberId: string): Promise<TeamMemberModelPreference | undefined> {
		return (await this.read()).teams[teamId]?.[memberId];
	}

	async set(
		team: TeamDefinition,
		memberId: string,
		selection: TeamMemberModelSelection | null,
	): Promise<Readonly<Record<string, TeamMemberModelPreference>>> {
		const member = team.members.find((candidate) => candidate.id === memberId);
		if (!member) throw new Error(`Team member not found: ${memberId}`);
		const parsed = parseTeamMemberModelSelection(selection);
		const operation = this.mutationTail.then(async () => {
			const current = await this.read();
			const members = { ...(current.teams[team.id] ?? {}) };
			if (parsed) members[memberId] = { ...parsed, agentProfileId: member.binding.agentProfileId };
			else delete members[memberId];
			const next = { version: 1 as const, teams: { ...current.teams, [team.id]: members } };
			await mkdir(dirname(this.path), { recursive: true });
			await atomicWriteJSONAsync(this.path, next);
			this.document = next;
			return this.list(team);
		});
		this.mutationTail = operation.catch(() => undefined);
		return operation;
	}

	private async read(): Promise<z.infer<typeof DocumentSchema>> {
		if (this.document) return this.document;
		if (!this.loading)
			this.loading = (async () => {
				try {
					return DocumentSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
				} catch (error) {
					if (isMissingFile(error)) return { version: 1 as const, teams: {} };
					throw error;
				}
			})()
				.then((document) => {
					this.document = document;
					return document;
				})
				.finally(() => {
					this.loading = undefined;
				});
		return this.loading;
	}
}

function isMissingFile(value: unknown): boolean {
	return typeof value === "object" && value !== null && "code" in value && value.code === "ENOENT";
}

export const teamMemberModelPreferences = new TeamMemberModelPreferences();
