import {
	createSocialImage,
	socialImageAlt,
	socialImageContentType,
	socialImageSize,
} from "@/lib/seo/social-image";

export const alt = socialImageAlt;
export const size = socialImageSize;
export const contentType = socialImageContentType;
export default function OpenGraphImage() {
	return createSocialImage();
}
