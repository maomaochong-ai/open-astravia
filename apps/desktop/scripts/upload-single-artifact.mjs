import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

async function hashFile(filePath) {
	const hash = createHash("sha512");
	for await (const chunk of createReadStream(filePath)) hash.update(chunk);
	return hash.digest("hex");
}

async function main() {
	const version = process.env.VERSION || "0.5.64";
	const fileName = process.env.FILE_NAME || `vetta-${version}.x86_64.rpm`;
	const filePath = process.env.FILE_PATH || `/tmp/rpm-download/${fileName}`;
	const prefix = process.env.VETTA_R2_PREFIX || "desktop/stable";
	const bucket = process.env.VETTA_R2_BUCKET || "vetta-releases";

	const client = new S3Client({
		region: "auto",
		endpoint: `https://${process.env.VETTA_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: process.env.VETTA_R2_ACCESS_KEY_ID,
			secretAccessKey: process.env.VETTA_R2_SECRET_ACCESS_KEY,
		},
	});

	const fileStat = await stat(filePath);
	const sha512 = await hashFile(filePath);
	const key = posix.join(prefix, fileName);

	console.log(`Uploading ${filePath} (${fileStat.size} bytes) to ${key} with sha512=${sha512}...`);
	const upload = new Upload({
		client,
		queueSize: 4,
		partSize: 16 * 1024 * 1024,
		leavePartsOnError: false,
		params: {
			Bucket: bucket,
			Key: key,
			Body: createReadStream(filePath),
			ContentLength: fileStat.size,
			ContentType: "application/x-rpm",
			CacheControl: "public, max-age=31536000, immutable",
			Metadata: { sha512 },
		},
	});
	await upload.done();
	console.log(`Successfully uploaded ${key}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
