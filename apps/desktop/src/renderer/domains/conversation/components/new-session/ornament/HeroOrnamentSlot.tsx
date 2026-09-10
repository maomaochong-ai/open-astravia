import { useHeroOrnament } from "@shared/hooks/useHeroOrnament";
import { ORNAMENT_COMPONENTS, type OrnamentProps } from "./ornament-registry";

/**
 * 装饰件位：新会话页 hero 右下角、趴在输入框顶边上的那块挂饰。
 *
 * 这里只负责按「设置 - 外观 - 装饰件」选中的 id 取出实现；位置、尺寸、
 * 是否随页面宽度收起都由各装饰件自己决定（共用 `useOrnamentSlot`）。
 */
export function HeroOrnamentSlot({ autoplay, mounted }: OrnamentProps): JSX.Element | null {
	const { ornamentId } = useHeroOrnament();
	const Ornament = ORNAMENT_COMPONENTS[ornamentId];

	if (!Ornament) return null;
	return <Ornament autoplay={autoplay} mounted={mounted} />;
}
