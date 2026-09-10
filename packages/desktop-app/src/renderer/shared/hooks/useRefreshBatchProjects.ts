import { batchProjectsAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback } from "react";

/**
 * Reload the batch task project list into its atom.
 *
 * Batch projects are discovered from desktop-config.json (entries whose
 * `.astravia/meta.json` says `type: "batch"`), not from the plain project
 * list, so any action that registers a directory — creating or opening a
 * project, importing an archive — must refresh this list as well, otherwise
 * the project stays invisible in the sidebar's batch group.
 */
export function useRefreshBatchProjects(): () => Promise<void> {
	const setBatchProjects = useSetAtom(batchProjectsAtom);
	return useCallback(async () => {
		const loadedProjects = await window.astravia.batchTasks.getProjects();
		setBatchProjects(loadedProjects);
	}, [setBatchProjects]);
}
