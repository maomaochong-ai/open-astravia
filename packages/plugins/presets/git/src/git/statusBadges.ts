import type {
	PluginFileExplorerDecoration,
	PluginFileExplorerDecorationProvider,
	PluginFileExplorerEntry,
} from "@astravia-org/plugin-sdk";
import { collapseByPath } from "./parseStatus";
import type { ChangeCode, StatusGroups } from "./types";

type DecorationColor = NonNullable<PluginFileExplorerDecoration["color"]>;

interface BadgeSpec {
	badge: string;
	color: DecorationColor;
	tooltip: string;
}

/**
 * 文件树右侧的一字状态标记。字母沿用 git 自己的说法（`M` 修改、`A` 新增、`D` 删除、
 * `R` 重命名、`U` 未跟踪），冲突没有对应的 porcelain 字母，用 `!` 单列出来。
 * tooltip 是插件文案键，由宿主按当前语言解析。
 */
const BADGES: Record<ChangeCode, BadgeSpec> = {
	M: { badge: "M", color: "warning", tooltip: "%badge.modified%" },
	A: { badge: "A", color: "success", tooltip: "%badge.added%" },
	D: { badge: "D", color: "error", tooltip: "%badge.deleted%" },
	R: { badge: "R", color: "accent", tooltip: "%badge.renamed%" },
	U: { badge: "U", color: "accent", tooltip: "%badge.untracked%" },
	C: { badge: "!", color: "error", tooltip: "%badge.conflict%" },
};

/** 正斜杠、无尾随分隔符。Windows 下 git 输出正斜杠而宿主路径可能是反斜杠。 */
export function normalizeFsPath(path: string): string {
	const slashed = path.replace(/\\/g, "/");
	return slashed.length > 1 ? slashed.replace(/\/+$/, "") : slashed;
}

/** `git rev-parse --show-prefix` 的输出 → 可直接拼接的前缀（仓库根为空串）。 */
export function normalizeRepoPrefix(prefix: string): string {
	const slashed = prefix.replace(/\\/g, "/").replace(/^\/+/, "");
	return slashed.length === 0 ? "" : `${slashed.replace(/\/+$/, "")}/`;
}

/**
 * 一次 `git status` 结果 → 「仓库相对路径 → 状态字母」。同一路径同时出现在暂存区和工作区时
 * 只留一个字母（复用面板的分档规则：冲突优先，其次非 `M` 优先），否则同一个文件会有两个标记。
 */
export function buildStatusCodes(groups: StatusGroups): Map<string, ChangeCode> {
	const codes = new Map<string, ChangeCode>();
	for (const entry of collapseByPath(groups)) codes.set(normalizeFsPath(entry.path), entry.code);
	return codes;
}

export function badgeDecoration(code: ChangeCode): PluginFileExplorerDecoration {
	return { ...BADGES[code], propagate: true };
}

/**
 * 一个工作区根的状态视图。
 *
 * git 只按仓库根给相对路径，而宿主的文件树按工作区根给绝对路径，两者未必是同一个目录
 * （根可以是仓库里的子目录），也可能只是写起来不同（macOS 的 `/var` 与 `/private/var`、
 * Windows 的 8.3 短名）。所以这里存「工作区根 + 它在仓库内的前缀」，查表时才拼路径，
 * 不依赖两边字符串前缀相同。
 */
export interface StatusSlice {
	workspaceRoot: string;
	/** 仓库相对路径 → 状态字母。 */
	codes: ReadonlyMap<string, ChangeCode>;
	/** 工作区根在仓库内的相对前缀，`normalizeRepoPrefix` 归一过。 */
	repoPrefix: string;
}

/** 每次渲染行都会调一次，只做内存查表；git 命令由 statusRefresher 在后台跑。 */
export class FileStatusBadges {
	private slices: StatusSlice[] = [];
	private listeners = new Set<(entries?: readonly PluginFileExplorerEntry[]) => void>();

	/** 整体替换；工作区根按路径长度倒序，嵌套根取更深的那份。 */
	replace(slices: readonly StatusSlice[]): void {
		this.slices = [...slices].sort((left, right) => right.workspaceRoot.length - left.workspaceRoot.length);
		for (const listener of this.listeners) listener(undefined);
	}

	codeFor(path: string): ChangeCode | null {
		const target = normalizeFsPath(path);
		for (const slice of this.slices) {
			const root = normalizeFsPath(slice.workspaceRoot);
			if (target !== root && !target.startsWith(`${root}/`)) continue;
			const relative = target.slice(root.length + 1);
			const code = slice.codes.get(`${slice.repoPrefix}${relative}`);
			if (code) return code;
		}
		return null;
	}

	provider(): PluginFileExplorerDecorationProvider {
		return {
			id: "status-badges",
			// 状态取决于该文件在仓库里的变化，与扩展名无关，因此不设 `when`。
			provideDecoration: (entry) => {
				if (entry.isDirectory) return null;
				const code = this.codeFor(entry.path);
				return code ? badgeDecoration(code) : null;
			},
			// 展开出来的父目录靠 `propagate` 继承子文件的状态；未展开的目录不下发，
			// 因为声明条目要填 stat，而我们没有理由为它额外读一次盘。
			onDidChangeDecorations: (listener) => {
				this.listeners.add(listener);
				return { dispose: () => this.listeners.delete(listener) };
			},
		};
	}
}
