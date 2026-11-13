import { formatBytes, STORAGE_CONFIG } from "@workspace/api/storage";
import { client, parseApiResponse } from "./api-client";

const IMAGE_UPLOAD_TYPES = STORAGE_CONFIG.ALLOWED_CONTENT_TYPES.filter((type) =>
	type.startsWith("image/")
);

export function validateImageUploadFile(
	file: File,
	maxBytes = STORAGE_CONFIG.BYTES_PER_MB * 5
): string | null {
	if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
		return "Please upload a valid image file (PNG, JPG, WebP, or GIF)";
	}
	if (file.size > maxBytes) {
		return `Image file size must be under ${formatBytes(maxBytes, 0)}`;
	}
	return null;
}

export async function uploadFileToStorage(file: File): Promise<string> {
	const presignRes = await client.api.storage.presign.$post({
		json: {
			contentType: file.type,
			fileName: file.name,
			size: file.size,
		},
	});
	const uploadData = await parseApiResponse<{
		fileKey: string;
		fileUrl?: string;
		publicUrl?: string;
		url: string;
	}>(presignRes);

	const uploadRes = await fetch(uploadData.url, {
		body: file,
		headers: {
			"Content-Type": file.type,
		},
		method: "PUT",
	});

	if (!uploadRes.ok) {
		throw new Error("Failed to upload image to storage service");
	}

	const commitRes = await client.api.storage.commit.$post({
		json: {
			fileKeys: [uploadData.fileKey],
		},
	});
	await parseApiResponse(commitRes);

	const resolvedUrl = uploadData.fileUrl ?? uploadData.publicUrl;
	if (!resolvedUrl) {
		throw new Error("Storage service did not return a file URL");
	}

	return resolvedUrl;
}
