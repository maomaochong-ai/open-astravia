import { motion } from "motion/react";
import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@vetta/theme-sdk";
import type {
	NewSessionHeroIdentity,
	NewSessionHeroProps,
	NewSessionSceneActionState,
	NewSessionSceneCarouselLabels,
	NewSessionSceneItem,
} from "@vetta/theme-ui";
import { AgentAvatarView } from "@vetta/theme-ui/chat";
import { type CSSProperties, useRef } from "react";
import { GuideBadgeSwiper } from "../GuideBadgeSwiper";
import { easeOut } from "./constants";
import "./NewSessionHero.css";
import { NewSessionMascot } from "./NewSessionMascot";

interface NewSessionHeroHostProps {
	avatarAutoplay: boolean;
	greetingTitle: string;
	identity: NewSessionHeroIdentity | null;
	mounted: boolean;
	subtitle: string;
}

// 场景轮播已从新会话页下线；hero 的场景相关 props 仍属于主题公共契约，
// 这里传恒定空值让默认实现与第三方主题都渲染不出场景。
const EMPTY_SCENES: readonly NewSessionSceneItem[] = [];
const EMPTY_SCENE_ACTIONS: Readonly<Record<string, NewSessionSceneActionState>> = {};
const EMPTY_SCENE_LABELS: NewSessionSceneCarouselLabels = { installPrompt: "", next: "", previous: "" };
function noopSceneClick(): void {}

/** Host 入口：解析主题 override，补齐 i18n labels 后交给 public props contract。 */
export function NewSessionHero({
	avatarAutoplay,
	greetingTitle,
	identity,
	mounted,
	subtitle,
}: NewSessionHeroHostProps): JSX.Element {
	const ThemedHero = useThemeComponent("chat.newSessionHero", DefaultNewSessionHero);

	return (
		<ThemedHero
			avatarAutoplay={avatarAutoplay}
			greetingTitle={greetingTitle}
			identity={identity}
			mounted={mounted}
			onSceneClick={noopSceneClick}
			reserveSceneSlot={false}
			sceneActions={EMPTY_SCENE_ACTIONS}
			sceneLabels={EMPTY_SCENE_LABELS}
			scenes={EMPTY_SCENES}
			selected={null}
			subtitle={subtitle}
		/>
	);
}

/** 头像直径（px）：与下方 AgentAvatarView 的 `hero` 尺寸一致。 */
const AVATAR_SIZE = 56;
/** 头像组与标题之间的留白，一并算进槽高，收起时连同间距一起收掉。 */
const AVATAR_GAP = 10;
/** 头像组最多摆几枚：再多就挤掉标题宽度，多出来的成员折成末位的 “+n”。 */
const AVATAR_LIMIT = 3;

function avatarSlotHeight(count: number): string {
	return count <= 0 ? "0px" : `${AVATAR_SIZE + AVATAR_GAP}px`;
}

export function DefaultNewSessionHero({
	avatarAutoplay,
	className,
	greetingTitle,
	identity = null,
	mounted,
	onSceneClick: _onSceneClick,
	reserveSceneSlot: _reserveSceneSlot,
	sceneActions: _sceneActions,
	sceneLabels: _sceneLabels,
	scenes: _scenes,
	selected: _selected,
	subtitle,
	...props
}: NewSessionHeroProps): JSX.Element {
	// 取消选择时 identity 立刻变 null，但头像槽还要收一段宽度：留住上一个身份的头像，
	// 让它跟着槽一起收起来，而不是先凭空消失再收一个空盒子。
	const lastIdentity = useRef<NewSessionHeroIdentity | null>(identity);
	if (identity) lastIdentity.current = identity;
	const shownIdentity = lastIdentity.current;

	return (
		<div className={cn("relative mb-3 flex w-full max-w-2xl flex-col items-start", className)} {...props}>
			<motion.div
				initial={{ opacity: 0, y: 12 }}
				animate={{ opacity: mounted ? 1 : 0, y: mounted ? 0 : 12 }}
				transition={{ duration: 0.5, ease: easeOut }}
				className="flex w-full flex-col items-start"
			>
				{/* 欢迎语上方：引导 badge 轮播。工作模式切换已移到输入框上方的选项行。 */}
				<GuideBadgeSwiper mounted={mounted} />

				{/* 标题块：身份头像组压在标题上方 + 问候语/身份名 + 副标题（吉祥物改为绝对定位，见下） */}
				<div className="flex w-full min-w-0 flex-col">
					<div
						aria-hidden
						className="ns-hero-avatar-slot"
						data-visible={identity ? "true" : "false"}
						style={
							{ "--ns-hero-avatar-height": avatarSlotHeight(shownIdentity?.avatars.length ?? 0) } as CSSProperties
						}
					>
						{shownIdentity && (
							// key 换了就重播入场：切到另一个智能体/团队时头像要重新落位。
							<div key={shownIdentity.key} className="flex items-center">
								{shownIdentity.avatars.slice(0, AVATAR_LIMIT).map((avatar, index) => (
									<AgentAvatarView
										key={`${avatar.name}:${index}`}
										name={avatar.name}
										size="hero"
										className={cn("ring-2 ring-background", index > 0 && "-ml-4")}
										{...(avatar.avatar ? { avatar: avatar.avatar } : {})}
										{...(avatar.blueprintId ? { blueprintId: avatar.blueprintId } : {})}
									/>
								))}
								{shownIdentity.avatars.length > AVATAR_LIMIT && (
									// 末位补一枚同尺寸的 “+n”，让 4 人及以上的团队不至于看起来只有 3 个人。
									<span
										data-avatar-overflow={shownIdentity.avatars.length - AVATAR_LIMIT}
										// 底色必须是实色：这枚圆片压在前一枚头像上，半透明会把下面的脸透出来。
										className="-ml-4 inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-card text-[15px] font-semibold tabular-nums text-foreground ring-2 ring-background"
									>
										+{shownIdentity.avatars.length - AVATAR_LIMIT}
									</span>
								)}
							</div>
						)}
					</div>
					{/* key 随身份变化：标题与描述整块重播 CSS 入场动画，回到问候语时同理。 */}
					<div key={identity?.key ?? "greeting"} className="flex min-w-0 flex-col">
						<h1 className="ns-hero-identity-title min-w-0 truncate bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-[24px] font-semibold tracking-[-0.02em] text-transparent">
							{identity?.title ?? greetingTitle}
						</h1>
						<p className="ns-hero-identity-subtitle mt-1 truncate text-[12px] text-muted-foreground/70">
							{identity ? identity.subtitle || subtitle : subtitle}
						</p>
					</div>
				</div>
			</motion.div>

			{/* 吉祥物脱离文档流下移，视觉上趴在输入栏顶边上 */}
			<NewSessionMascot autoplay={avatarAutoplay} mounted={mounted} />
		</div>
	);
}
