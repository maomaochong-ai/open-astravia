import type { PersistentSurfaceId } from "./persistent-surface";

export type PersistentSurfaceTitleRef =
	| { readonly ns: "abilities"; readonly key: "page.title" }
	| { readonly ns: "agent-teams"; readonly key: "center.title" }
	| { readonly ns: "automation"; readonly key: "page.title" }
	| { readonly ns: "batch-tasks"; readonly key: "page.title" }
	| { readonly ns: "settings"; readonly key: "kbPageTitle" | "kbAllTitle" | "title" }
	| { readonly ns: "skills"; readonly key: "tabs.scene" }
	| { readonly ns: "chat"; readonly key: "newSession.greetingDefault" };

/**
 * 保活页首访壳用的标题。新会话没有产品名标题，壳直接用问候语，和页内 hero 同一句。
 */
export function persistentSurfaceTitleRef(id: Exclude<PersistentSurfaceId, "chat">): PersistentSurfaceTitleRef {
	switch (id) {
		case "abilities":
			return { ns: "abilities", key: "page.title" };
		case "agents":
			return { ns: "agent-teams", key: "center.title" };
		case "automation":
			return { ns: "automation", key: "page.title" };
		case "batch-tasks":
			return { ns: "batch-tasks", key: "page.title" };
		case "knowledge":
			return { ns: "settings", key: "kbPageTitle" };
		case "knowledge-all":
			return { ns: "settings", key: "kbAllTitle" };
		case "scenes":
			return { ns: "skills", key: "tabs.scene" };
		case "settings":
			return { ns: "settings", key: "title" };
		case "new-session":
			return { ns: "chat", key: "newSession.greetingDefault" };
	}
}
