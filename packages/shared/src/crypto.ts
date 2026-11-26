import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes,
} from "node:crypto";

const ENCRYPTED_PREFIX = "enc:v1:";
const CIPHER_ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const DERIVED_KEY_LENGTH_BYTES = 32;
const MIN_SECRET_LENGTH = 32;
const HKDF_SALT = "e2e-ai-starter-field-encryption-v1";
const HKDF_INFO = "aes-256-gcm";

function deriveAesKey(secretKey: string): Buffer {
	if (typeof secretKey !== "string" || secretKey.length < MIN_SECRET_LENGTH) {
		throw new Error(
			`Encryption secret must be at least ${MIN_SECRET_LENGTH} characters`
		);
	}
	return Buffer.from(
		hkdfSync(
			"sha256",
			secretKey,
			HKDF_SALT,
			HKDF_INFO,
			DERIVED_KEY_LENGTH_BYTES
		)
	);
}

/**
 * Checks whether a stored string already carries the `enc:v1:` envelope prefix.
 */
export function isEncryptedValue(value: string | null | undefined): boolean {
	return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypts a plaintext string using AES-256-GCM with an HKDF-SHA256 derived key.
 * Idempotent: returns already-encrypted (`enc:v1:`) strings unchanged.
 */
export function encryptSecretValue(
	plaintext: string,
	secretKey: string
): string {
	if (isEncryptedValue(plaintext)) {
		return plaintext;
	}

	const key = deriveAesKey(secretKey);
	const iv = randomBytes(IV_LENGTH_BYTES);
	const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, {
		authTagLength: AUTH_TAG_LENGTH_BYTES,
	});
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return `${ENCRYPTED_PREFIX}${iv.toString("base64url")}:${authTag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

/**
 * Decrypts an `enc:v1:` AES-256-GCM payload and verifies its authentication tag.
 * Non-prefixed values are returned as-is for backward compatibility with legacy/dev rows.
 */
export function decryptSecretValue(value: string, secretKey: string): string {
	if (!isEncryptedValue(value)) {
		return value;
	}

	const payload = value.slice(ENCRYPTED_PREFIX.length);
	const parts = payload.split(":");
	if (parts.length !== 3) {
		throw new Error("Malformed encrypted secret payload");
	}

	const [ivPart, tagPart, cipherPart] = parts;
	if (!(ivPart && tagPart && cipherPart !== undefined)) {
		throw new Error("Malformed encrypted secret payload");
	}

	const iv = Buffer.from(ivPart, "base64url");
	const authTag = Buffer.from(tagPart, "base64url");
	const ciphertext = Buffer.from(cipherPart, "base64url");

	if (
		iv.length !== IV_LENGTH_BYTES ||
		authTag.length !== AUTH_TAG_LENGTH_BYTES
	) {
		throw new Error("Invalid encrypted secret envelope lengths");
	}

	const key = deriveAesKey(secretKey);
	const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv, {
		authTagLength: AUTH_TAG_LENGTH_BYTES,
	});
	decipher.setAuthTag(authTag);

	const plaintext = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);
	return plaintext.toString("utf8");
}

export function encryptNullableSecret(
	value: string | null | undefined,
	secretKey: string
): string | null | undefined {
	if (value === null || value === undefined || value === "") {
		return value;
	}
	return encryptSecretValue(value, secretKey);
}

export function decryptNullableSecret(
	value: string | null | undefined,
	secretKey: string
): string | null | undefined {
	if (value === null || value === undefined || value === "") {
		return value;
	}
	return decryptSecretValue(value, secretKey);
}
