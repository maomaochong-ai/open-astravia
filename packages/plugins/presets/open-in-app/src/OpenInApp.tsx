import {
	type PluginContext,
	type PluginExternalApplication,
	type PluginHeaderActionMenuItem,
	type PluginHeaderActionState,
	useActiveConversation,
	useTranslation,
} from "@astravia-org/plugin-sdk";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { KIND_ICON, MAX_MENU_ITEMS, isOpenableCwd, labelKeyFor, sortForMenu } from "./apps";

type ShellApi = PluginContext["shell"];
type NotifyApi = PluginContext["ui"]["notify"];

let shellApi: ShellApi | undefined;
let notifyApi: NotifyApi | undefined;
/** 按项目目录缓存的探测结果：一次运行里装了哪些应用基本不变，每次打开菜单都问一遍只是白跑系统调用。 */
let detected = new Map<string, Promise<readonly PluginExternalApplication[]>>();

export function setHostApis(shell: ShellApi | undefined, notify: NotifyApi | undefined): void {
	shellApi = shell;
	notifyApi = notify;
	detected = new Map();
}

/**
 * 只释放自己那一次激活登记的接口。
 * 宿主热重载/重试时，新一次激活可能先于旧一次的清理完成；无条件清空会把新接口一并抹掉，
 * 按钮就永远是空的（或菜单永远加载不出应用）。
 */
export function releaseHostApis(shell: ShellApi | undefined): void {
	if (shellApi !== shell) return;
	shellApi = undefined;
	notifyApi = undefined;
	detected = new Map();
}

function detect(cwd: string): Promise<readonly PluginExternalApplication[]> {
	const cached = detected.get(cwd);
	if (cached) return cached;
	const pending = (async () => {
		const shell = shellApi;
		if (!shell) return [];
		try {
			return await shell.listExternalApplications(cwd);
		} catch {
			// 探测失败按「本机没有可用应用」处理：按钮仍在，菜单里会出现「没有可用应用」。
			return [];
		}
	})();
	detected.set(cwd, pending);
	return pending;
}

function iconFor(app: PluginExternalApplication): ReactElement {
	// 应用自己的图标优先；宿主拿不到（Linux 某些桌面、绿色包）时退回分类图标，至少还能认出来。
	return app.iconUrl ? (
		<img src={app.iconUrl} alt="" className="size-4 shrink-0" draggable={false} />
	) : (
		<span className={`${KIND_ICON[app.kind]} size-4 shrink-0`} />
	);
}

/**
 * 顶栏动作的声明 hook（`registerHeaderAction({ useAction })`）。
 *
 * 返回 `null` 表示此刻不适用：没有活动目录、目录在远端（SSH 项目）或还没探测完，
 * 宿主据此不渲染、也不占顶栏名额。
 */
export function useOpenInAppAction(): PluginHeaderActionState | null {
	const { t } = useTranslation();
	const { cwd } = useActiveConversation();
	const [applications, setApplications] = useState<readonly PluginExternalApplication[] | null>(null);
	const openable = isOpenableCwd(cwd);

	useEffect(() => {
		if (!openable) return;
		let cancelled = false;
		void detect(cwd).then((found) => {
			if (!cancelled) setApplications(found);
		});
		return () => {
			cancelled = true;
		};
	}, [cwd, openable]);

	return useMemo(() => {
		if (!openable || !cwd || applications === null) return null;

		const fail = (error: unknown): void => {
			notifyApi?.({ message: t("error.failed"), variant: "error", error });
		};
		const open = async (app: PluginExternalApplication): Promise<void> => {
			try {
				await shellApi?.openPathWithApplication(cwd, app.id, app.kind);
			} catch (error) {
				fail(error);
			}
		};
		const openWithDefault = async (): Promise<void> => {
			try {
				await shellApi?.openPathWithDefaultApplication(cwd);
			} catch (error) {
				fail(error);
			}
		};

		// 宿主对 menuItems 的硬上限是 20 项、超出部分直接丢掉，所以应用列表要留一格给末尾的「默认应用」，
		// 否则刚好探测到 20 个应用时那一项会被默默裁掉。
		const visible = sortForMenu(applications).slice(0, MAX_MENU_ITEMS - 1);
		const menuItems: PluginHeaderActionMenuItem[] = visible.map((app, index) => {
			const key = labelKeyFor(app);
			return {
				id: app.id,
				label: key ? t(key) : app.name,
				icon: iconFor(app),
				onSelect: () => void open(app),
				// 文件管理器放到第一组末尾：编辑器是常用入口，文件管理器与终端属于「换个地方看」。
				separatorBefore: index > 0 && app.kind !== "editor" && visible[index - 1]?.kind === "editor",
			};
		});
		// 探测不到任何应用时也要能打开：菜单只留「用系统默认应用打开」。
		menuItems.push({
			id: "__default",
			label: t("action.openDefault"),
			icon: <span className="icon-[solar--folder-open-linear] size-4" />,
			onSelect: () => void openWithDefault(),
			separatorBefore: menuItems.length > 0,
		});

		return {
			title: t("action.title"),
			icon: <span className="icon-[solar--square-arrow-right-up-linear]" />,
			menuItems,
		};
	}, [applications, cwd, openable, t]);
}
