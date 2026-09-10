import { useNewSessionTexture } from "@shared/hooks/useNewSessionTexture";
import { NEW_SESSION_TEXTURE_COMPONENTS } from "@shared/theme/new-session-texture";

/**
 * 新会话页底衬：整块交给「设置 - 外观 - 纹理」选中的那档纹理来画。
 *
 * 网格与页面中间那团光晕同属「网格」这一档：选「无」就是整块背景什么都不画，
 * 只剩页面本身的底色。
 */
export function NewSessionBackground(): JSX.Element | null {
	const { textureId } = useNewSessionTexture();
	const Texture = NEW_SESSION_TEXTURE_COMPONENTS[textureId];

	return Texture ? <Texture /> : null;
}
