import { loginPopoverOpenAtom } from "@shared/store/atoms";
import { useThemeComponent } from "@vetta/theme-sdk";
import { Popover, PopoverAnchor, PopoverContent } from "@vetta/ui";
import { useAtom } from "jotai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useOAuthLogin } from "../hooks/useOAuthLogin";
import { LoginPopoverView } from "./LoginPopoverView";

/**
 * 授权登录的等待浮层，挂在侧边栏底部（设置菜单同一位置）。
 *
 * 打开即发起授权——设置菜单里点「登录」只需一次点击就能跳到浏览器，
 * 这里不再放一个「授权登录」按钮让用户点第二次。
 */
export function LoginPopover(): JSX.Element {
	const [open, setOpen] = useAtom(loginPopoverOpenAtom);
	const ThemedLoginPopoverView = useThemeComponent("root.loginPopoverView", LoginPopoverView);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			{/* 零高度锚点：贴着侧边栏底部，浮层朝上左对齐弹出 */}
			<PopoverAnchor asChild>
				<span className="block h-0 w-full" />
			</PopoverAnchor>
			<AnimatePresence>
				{open && (
					<PopoverContent
						forceMount
						asChild
						side="top"
						align="start"
						sideOffset={6}
						className="w-[228px] overflow-hidden rounded-lg border border-border p-0"
						style={{ animation: "none" }}
					>
						<motion.div
							initial={{ opacity: 0, scale: 0.96, y: 8 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							exit={{ opacity: 0, scale: 0.96, y: 8 }}
							transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
						>
							<LoginPopoverBody View={ThemedLoginPopoverView} />
						</motion.div>
					</PopoverContent>
				)}
			</AnimatePresence>
		</Popover>
	);
}

interface LoginPopoverBodyProps {
	readonly View: typeof LoginPopoverView;
}

/**
 * 浮层内容。只在打开期间挂载，故「挂载即发起授权」等价于「点开即跳浏览器」。
 * 授权成功由 useAuth 统一落地 token 并关掉本浮层。
 */
function LoginPopoverBody({ View }: LoginPopoverBodyProps): JSX.Element {
	const { t } = useTranslation("common");
	const { phase, error, start, reopen } = useOAuthLogin();
	const startedRef = useRef(false);

	useEffect(() => {
		// ref 守卫：StrictMode 下 effect 会跑两次，否则要开两个浏览器标签页。
		if (startedRef.current) return;
		startedRef.current = true;
		start();
	}, [start]);

	return (
		<View
			error={error}
			labels={{
				reopen: t("login.reopen"),
				retry: t("login.retry"),
				waitingHint: t("login.waitingHint"),
				waitingTitle: t("login.waitingTitle"),
			}}
			onReopen={reopen}
			onRetry={() => {
				// 失败后重试：关掉再由调用方重开会更绕，这里直接重新发起一次。
				start();
			}}
			phase={phase}
		/>
	);
}
