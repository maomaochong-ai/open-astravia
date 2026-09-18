import { pathBasename } from "@shared/lib/utils";

/**
 * 项目详情、会话查看器、主题托管页与主对话分开记账：身份来自 URL，数量不固定，用 LRU 保活最近几个。
 */
export type DetailSurfaceKind = "project" | "viewer" | "theme";

export type DetailSurfaceRef =
	| {
			readonly kind: "project";
			readonly key: string;
			readonly cwd: string;
	  }
	| {
			readonly kind: "viewer";
			readonly key: string;
			readonly path: string;
	  }
	| {
			readonly kind: "theme";
			readonly key: string;
			readonly themeId: string;
			readonly pageId: string;
	  };

/** 同时保活的详情页上限：切回最近用过的不必卸树。 */
export const MAX_RESIDENT_DETAIL_SURFACES = 2;

/** 详情首帧壳标题：宿主传入的是已解码文件系统路径。 */
export function projectDetailShellTitle(cwd: string | undefined, fallback: string): string {
	if (!cwd) return fallback;
	return pathBasename(cwd) || fallback;
}

const PROJECT_PATH = /^\/project\/([^/]+)\/?$/;
const VIEWER_PATH = /^\/viewer\/([^/]+)\/?$/;
const THEME_PATH = /^\/theme\/([^/]+)\/([^/]+)\/?$/;

function decodePathSegment(segment: string): string | null {
	try {
		const decoded = decodeURIComponent(segment);
		return decoded || null;
	} catch {
		return null;
	}
}

/**
 * `/project/$cwd` 与 `/viewer/$path` 的参数值本身就是编码过的（见导航处的 encodeURIComponent），
 * 路由器写进 `match.pathname` 时又会再编一层，所以这里拿到的段是双层编码；只解一次会留下
 * `%2FUsers%2F…%E6%97%A0…` 这种半成品，项目详情页标题因此显示成一串百分号转义。
 *
 * 解第一层后若已经是绝对路径就收手，否则再解一层：既认双层，也兼容手写的单层路径，
 * 且不会把目录名里字面量的 `%`（如 `/tmp/100%done`）当成转义继续啃。
 */
function decodeFsPathSegment(segment: string): string | null {
	const first = decodePathSegment(segment);
	if (!first) return null;
	if (isAbsoluteFsPath(first)) return first;
	return decodePathSegment(first);
}

function isAbsoluteFsPath(value: string): boolean {
	return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

export function detailSurfaceForPath(pathname: string): DetailSurfaceRef | null {
	const path = pathname === "" ? "/" : pathname;
	const projectMatch = PROJECT_PATH.exec(path);
	if (projectMatch?.[1]) {
		const cwd = decodeFsPathSegment(projectMatch[1]);
		if (!cwd) return null;
		return { kind: "project", key: `project:${cwd}`, cwd };
	}
	const viewerMatch = VIEWER_PATH.exec(path);
	if (viewerMatch?.[1]) {
		const decodedPath = decodeFsPathSegment(viewerMatch[1]);
		if (!decodedPath) return null;
		return { kind: "viewer", key: `viewer:${decodedPath}`, path: decodedPath };
	}
	const themeMatch = THEME_PATH.exec(path);
	if (themeMatch?.[1] && themeMatch[2]) {
		const themeId = decodePathSegment(themeMatch[1]);
		const pageId = decodePathSegment(themeMatch[2]);
		if (!themeId || !pageId) return null;
		return { kind: "theme", key: `theme:${themeId}/${pageId}`, themeId, pageId };
	}
	return null;
}

export function rememberVisitedDetail(
	visited: readonly DetailSurfaceRef[],
	next: DetailSurfaceRef | null,
): readonly DetailSurfaceRef[] {
	if (!next) return visited;
	const last = visited[visited.length - 1];
	if (last?.key === next.key) return visited;
	const without = visited.filter((item) => item.key !== next.key);
	const stacked = [...without, next];
	if (stacked.length <= MAX_RESIDENT_DETAIL_SURFACES) return stacked;
	return stacked.slice(-MAX_RESIDENT_DETAIL_SURFACES);
}
