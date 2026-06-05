import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { encryptAesEcb, decryptAesEcb, aesEcbPaddedSize } from "./aes-ecb.js";

describe("AES-128-ECB", () => {
  it("encrypt and decrypt round-trip", () => {
    const key = crypto.randomBytes(16);
    const plaintext = Buffer.from("Hello WeChat CDN! 测试数据 123");
    const encrypted = encryptAesEcb(plaintext, key);
    const decrypted = decryptAesEcb(encrypted, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("handles data larger than one block", () => {
    const key = crypto.randomBytes(16);
    const bigData = crypto.randomBytes(1024);
    const encrypted = encryptAesEcb(bigData, key);
    const decrypted = decryptAesEcb(encrypted, key);
    expect(bigData.equals(decrypted)).toBe(true);
  });

  it("padded size calculation", () => {
    expect(aesEcbPaddedSize(16)).toBe(32);
    expect(aesEcbPaddedSize(20)).toBe(32);
    expect(aesEcbPaddedSize(32)).toBe(48);
  });
});
