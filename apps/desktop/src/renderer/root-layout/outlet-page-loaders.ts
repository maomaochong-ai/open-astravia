import type { ComponentType } from "react";

type PageModule = { default: ComponentType };

function memoizeLoader(load: () => Promise<PageModule>): () => Promise<PageModule> {
	let promise: Promise<PageModule> | null = null;
	return () => {
		promise ??= load();
		return promise;
	};
}

export const loadProjectDetailPage = memoizeLoader(() =>
	import("../domains/project/components/ProjectDetailPage").then((module) => ({
		default: module.ProjectDetailPage,
	})),
);

export const loadSessionViewerPage = memoizeLoader(() =>
	import("../domains/conversation/components/SessionViewerPage").then((module) => ({
		default: module.SessionViewerPage,
	})),
);

export const loadThemePageRoute = memoizeLoader(() =>
	import("../shared/theme/pages/ThemePageRoute").then((module) => ({
		default: module.ThemePageRoute,
	})),
);
