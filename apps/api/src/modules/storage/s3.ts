import {
	CreateBucketCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../env";

export const s3Client = new S3Client({
	credentials:
		env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
			? {
					accessKeyId: env.S3_ACCESS_KEY_ID,
					secretAccessKey: env.S3_SECRET_ACCESS_KEY,
				}
			: undefined,
	endpoint: env.S3_ENDPOINT,
	forcePathStyle: Boolean(env.S3_ENDPOINT),
	region: env.S3_REGION,
});

export function hasConfiguredS3Credentials(): boolean {
	return Boolean(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
}

let devBucketChecked = false;

export async function ensureDevBucketExists(): Promise<void> {
	if (
		devBucketChecked ||
		env.NODE_ENV !== "development" ||
		!env.S3_ENDPOINT ||
		!hasConfiguredS3Credentials()
	) {
		return;
	}
	devBucketChecked = true;
	try {
		await s3Client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
	} catch {
		// Bucket already exists or MinIO unavailable
	}
}

export function isS3NotFoundError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const err = error as {
		$metadata?: { httpStatusCode?: number };
		Code?: string;
		name?: string;
	};
	return (
		err.name === "NoSuchKey" ||
		err.name === "NotFound" ||
		err.Code === "NoSuchKey" ||
		err.$metadata?.httpStatusCode === 404
	);
}

export async function presignPutObject(params: {
	contentLength: number;
	contentType: string;
	expiresIn: number;
	fileKey: string;
}): Promise<string> {
	const command = new PutObjectCommand({
		Bucket: env.S3_BUCKET,
		ContentLength: params.contentLength,
		ContentType: params.contentType,
		Key: params.fileKey,
	});
	return await getSignedUrl(s3Client, command, { expiresIn: params.expiresIn });
}

export async function presignGetObject(params: {
	bucket: string;
	contentDisposition: string;
	contentType: string;
	expiresIn: number;
	fileKey: string;
}): Promise<string> {
	const command = new GetObjectCommand({
		Bucket: params.bucket,
		Key: params.fileKey,
		ResponseContentDisposition: params.contentDisposition,
		ResponseContentType: params.contentType,
	});
	return await getSignedUrl(s3Client, command, { expiresIn: params.expiresIn });
}

export async function headS3Object(params: {
	bucket: string;
	fileKey: string;
}) {
	return await s3Client.send(
		new HeadObjectCommand({
			Bucket: params.bucket,
			Key: params.fileKey,
		})
	);
}

export async function getS3ObjectBytes(params: {
	bucket: string;
	fileKey: string;
}): Promise<Uint8Array | undefined> {
	const object = await s3Client.send(
		new GetObjectCommand({
			Bucket: params.bucket,
			Key: params.fileKey,
		})
	);
	return await object.Body?.transformToByteArray();
}

export async function deleteS3Object(params: {
	bucket: string;
	fileKey: string;
}): Promise<void> {
	await s3Client.send(
		new DeleteObjectCommand({
			Bucket: params.bucket,
			Key: params.fileKey,
		})
	);
}
