import { TitledPageShell } from "@shared/components/TitledPageShell";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { PersistentSurfaceId } from "./persistent-surface";
import { persistentSurfaceTitleRef } from "./persistent-surface-shell";

function usePersistentSurfaceTitle(id: Exclude<PersistentSurfaceId, "chat">): string {
	const abilities = useTranslation("abilities");
	const agents = useTranslation("agent-teams");
	const automation = useTranslation("automation");
	const batchTasks = useTranslation("batch-tasks");
	const chat = useTranslation("chat");
	const settings = useTranslation("settings");
	const skills = useTranslation("skills");
	const ref = persistentSurfaceTitleRef(id);
	switch (ref.ns) {
		case "abilities":
			return abilities.t(ref.key);
		case "agent-teams":
			return agents.t(ref.key);
		case "automation":
			return automation.t(ref.key);
		case "batch-tasks":
			return batchTasks.t(ref.key);
		case "chat":
			return chat.t(ref.key);
		case "settings":
			return settings.t(ref.key);
		case "skills":
			return skills.t(ref.key);
	}
}

export function PersistentSurfaceShell({
	id,
}: {
	id: Exclude<PersistentSurfaceId, "chat">;
}): JSX.Element {
	return <TitledPageShell title={usePersistentSurfaceTitle(id)} />;
}

export function TeamChatSurfaceShell(): JSX.Element {
	const { t } = useTranslation("agent-teams");
	return <TitledPageShell title={t("teams.title")} />;
}
