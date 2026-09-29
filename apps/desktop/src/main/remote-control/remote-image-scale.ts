import { REMOTE_FILE_CHUNK_BYTES } from "@vetta/remote-control";
import { nativeImage } from "electron";

/** Long edge of an image sent to the phone; sharp on a phone screen, a fraction of a camera original. */
const MAX_EDGE = 2048;
const JPEG_QUALITY = 82;

/**
 * Scales a photo down for the phone. Returns undefined, so the original is sent,
 * when the image already fits in one chunk at a phone-sized resolution (keeping
 * PNG transparency) or when Electron cannot decode the format.
 */
export function scaleImageForPhone(bytes: Buffer): Buffer | undefined {
	const image = nativeImage.createFromBuffer(bytes);
	if (image.isEmpty()) return undefined;
	const { width, height } = image.getSize();
	const longEdge = Math.max(width, height);
	if (longEdge <= MAX_EDGE && bytes.byteLength <= REMOTE_FILE_CHUNK_BYTES) return undefined;
	const scaled =
		longEdge > MAX_EDGE
			? image.resize(width >= height ? { width: MAX_EDGE, quality: "good" } : { height: MAX_EDGE, quality: "good" })
			: image;
	return scaled.toJPEG(JPEG_QUALITY);
}
