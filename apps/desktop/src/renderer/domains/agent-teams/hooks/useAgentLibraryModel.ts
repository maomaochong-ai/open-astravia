import {
	type AgentAbilitySelection,
	type AgentBlueprint,
	type AgentProfile,
	type AgentTeamDocument,
	listLibraryAgentProfiles,
} from "@vetta/agent-team";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentCapabilityOption } from "../lib/capability-options";
import { loadAgentTeamConfigurationResources } from "../services/load-agent-team-resources";

export interface AgentLibraryCopy {
	readonly defaultName: string;
	readonly defaultDescription: string;
}

export function useAgentLibraryModel(copy: AgentLibraryCopy) {
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [blueprints, setBlueprints] = useState<readonly AgentBlueprint[]>([]);
	const [capabilities, setCapabilities] = useState<readonly AgentCapabilityOption[]>([]);
	const [selectedId, setSelectedId] = useState<string>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		void loadAgentTeamConfigurationResources()
			.then(({ document: nextDocument, blueprints: nextBlueprints, capabilities: nextCapabilities }) => {
				if (cancelled) return;
				setDocument(nextDocument);
				setBlueprints(nextBlueprints);
				setCapabilities(nextCapabilities);
				setSelectedId(nextDocument.agents.find((agent) => agent.scope.kind === "library")?.id);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(errorMessage(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const libraryAgents = useMemo(() => (document ? listLibraryAgentProfiles(document) : []), [document]);
	const selected = useMemo(() => libraryAgents.find((agent) => agent.id === selectedId), [libraryAgents, selectedId]);
	const blueprint = selected ? blueprints.find((candidate) => candidate.id === selected.blueprintId) : undefined;

	const createAgent = useCallback(async () => {
		const nextBlueprint = blueprints[0];
		if (!nextBlueprint) return;
		try {
			const created = await window.vetta.agentTeams.createAgent({
				name: copy.defaultName,
				description: copy.defaultDescription,
				mentionHandle: `agent-${libraryAgents.length + 1}`,
				blueprintId: nextBlueprint.id,
			});
			setDocument((current) => (current ? { ...current, agents: [...current.agents, created] } : current));
			setSelectedId(created.id);
			setError(undefined);
		} catch (cause) {
			setError(errorMessage(cause));
		}
	}, [blueprints, copy.defaultDescription, copy.defaultName, libraryAgents.length]);

	const previewAgent = useCallback(async (agentId: string) => {
		return window.vetta.agentTeams.previewAgentUpdate(agentId);
	}, []);

	const saveAgent = useCallback(
		async (agent: AgentProfile, input: AgentProfileEditInput) => {
			const updated = await window.vetta.agentTeams.updateAgent(agent.id, {
				expectedRevision: agent.revision,
				name: input.name,
				description: input.description,
				mentionHandle: input.mentionHandle,
				abilities: input.abilities,
			});
			setDocument((current) =>
				current
					? {
							...current,
							agents: current.agents.map((item) => (item.id === updated.id ? updated : item)),
						}
					: current,
			);
			return { updated, impact: await previewAgent(agent.id) };
		},
		[previewAgent],
	);

	const deleteAgent = useCallback(
		async (agent: AgentProfile): Promise<boolean> => {
			try {
				await window.vetta.agentTeams.deleteAgent(agent.id, { expectedRevision: agent.revision });
				setDocument((current) =>
					current
						? { ...current, agents: current.agents.filter((candidate) => candidate.id !== agent.id) }
						: current,
				);
				setSelectedId(libraryAgents.find((candidate) => candidate.id !== agent.id)?.id);
				setError(undefined);
				return true;
			} catch (cause) {
				setError(errorMessage(cause));
				return false;
			}
		},
		[libraryAgents],
	);

	return {
		document,
		libraryAgents,
		blueprints,
		capabilities,
		selected,
		blueprint,
		selectedId,
		loading,
		error,
		actions: {
			createAgent,
			previewAgent,
			saveAgent,
			deleteAgent,
			selectAgent: setSelectedId,
			clearError: () => setError(undefined),
		},
	};
}

export interface AgentProfileEditInput {
	readonly name: string;
	readonly description: string;
	readonly mentionHandle: string;
	readonly abilities: AgentAbilitySelection;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
