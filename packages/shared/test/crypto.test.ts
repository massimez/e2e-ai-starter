import { describe, expect, test } from "bun:test";
import {
	decryptNullableSecret,
	decryptSecretValue,
	encryptNullableSecret,
	encryptSecretValue,
	isEncryptedValue,
} from "../src/crypto";

const TEST_SECRET = "test_encryption_secret_at_least_32_characters_long";
const OTHER_SECRET = "another_encryption_secret_at_least_32_characters_x";

describe("@workspace/shared/crypto AES-256-GCM envelope encryption", () => {
	test("encrypts and decrypts secrets round-trip with random IVs", () => {
		const plaintext = "oauth_refresh_token_sensitive_value_123";
		const encA = encryptSecretValue(plaintext, TEST_SECRET);
		const encB = encryptSecretValue(plaintext, TEST_SECRET);

		expect(isEncryptedValue(encA)).toBe(true);
		expect(encA).toStartWith("enc:v1:");
		expect(encA).not.toBe(plaintext);
		expect(encA).not.toBe(encB);
		expect(decryptSecretValue(encA, TEST_SECRET)).toBe(plaintext);
		expect(decryptSecretValue(encB, TEST_SECRET)).toBe(plaintext);
	});

	test("is idempotent when encrypting an already encrypted value", () => {
		const encrypted = encryptSecretValue("secret-value", TEST_SECRET);
		expect(encryptSecretValue(encrypted, TEST_SECRET)).toBe(encrypted);
	});

	test("passes through legacy unencrypted strings on decrypt", () => {
		expect(isEncryptedValue("legacy-plain-token")).toBe(false);
		expect(decryptSecretValue("legacy-plain-token", TEST_SECRET)).toBe(
			"legacy-plain-token"
		);
	});

	test("rejects wrong key, tampered ciphertext, malformed envelopes, and short keys", () => {
		const encrypted = encryptSecretValue("top-secret", TEST_SECRET);

		expect(() => decryptSecretValue(encrypted, OTHER_SECRET)).toThrow();

		const parts = encrypted.split(":");
		const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${parts[4]}A`;
		expect(() => decryptSecretValue(tampered, TEST_SECRET)).toThrow();

		expect(() =>
			decryptSecretValue("enc:v1:only-two-parts", TEST_SECRET)
		).toThrow("Malformed encrypted secret payload");

		expect(() => encryptSecretValue("value", "too-short")).toThrow(
			"Encryption secret must be at least 32 characters"
		);
	});

	test("handles nullable and empty values cleanly", () => {
		expect(encryptNullableSecret(null, TEST_SECRET)).toBeNull();
		expect(encryptNullableSecret(undefined, TEST_SECRET)).toBeUndefined();
		expect(encryptNullableSecret("", TEST_SECRET)).toBe("");
		expect(decryptNullableSecret(null, TEST_SECRET)).toBeNull();
		expect(decryptNullableSecret(undefined, TEST_SECRET)).toBeUndefined();
		expect(decryptNullableSecret("", TEST_SECRET)).toBe("");

		const encrypted = encryptNullableSecret("push-auth-key", TEST_SECRET);
		expect(typeof encrypted).toBe("string");
		expect(decryptNullableSecret(encrypted, TEST_SECRET)).toBe("push-auth-key");
	});
});
