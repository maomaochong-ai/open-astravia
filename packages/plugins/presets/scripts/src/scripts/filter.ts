import type { ScriptProject } from "./model";

/** 按名字、命令、说明与项目路径做不分大小写的包含匹配；项目名命中时保留它的全部脚本。 */
export function filterProjects(projects: readonly ScriptProject[], query: string): ScriptProject[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...projects];
	const result: ScriptProject[] = [];
	for (const project of projects) {
		const projectHit = [project.relDir, project.packageName ?? ""].some((text) => text.toLowerCase().includes(needle));
		const scripts = projectHit
			? project.scripts
			: project.scripts.filter((script) =>
					[script.name, script.command, script.detail ?? ""].some((text) => text.toLowerCase().includes(needle)),
				);
		if (scripts.length > 0) result.push({ ...project, scripts });
	}
	return result;
}

export function countScripts(projects: readonly ScriptProject[]): number {
	return projects.reduce((total, project) => total + project.scripts.length, 0);
}
