import { cn } from "@shared/lib/utils";

type Props = {
	avatar?: string | null;
	nickname?: string | null;
	username?: string | null;
	/** 尺寸/形状类，如 "h-20 w-20" */
	className?: string;
	/** 文字大小类（无头像时首字符的字号），如 "text-3xl" */
	textClassName?: string;
};

/** 取昵称首字符，无昵称取用户名首字符（处理多字节/emoji） */
function initial(nickname?: string | null, username?: string | null): string {
	const name = (nickname?.trim() || username?.trim() || "").trim();
	if (!name) return "?";
	return [...name][0].toUpperCase();
}

/**
 * 用户头像：有头像显示头像；无头像用昵称/用户名首字符占位，
 * 字色为主题前景色、底色为主题色（bg-primary / text-primary-foreground）。
 */
export function UserAvatar({ avatar, nickname, username, className, textClassName }: Props): JSX.Element {
	if (avatar) {
		return <img src={avatar} alt="" className={cn("rounded-full object-cover", className)} />;
	}
	return (
		<div
			className={cn(
				"flex select-none items-center justify-center rounded-full bg-primary font-semibold leading-none text-primary-foreground",
				className,
				textClassName,
			)}
		>
			{initial(nickname, username)}
		</div>
	);
}
