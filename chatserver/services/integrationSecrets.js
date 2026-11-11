const { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const encryptionKey = () => {
  const configured = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  const key = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must encode exactly 32 bytes.");
  return key;
};

const encryptSecret = (secret) => {
  if (typeof secret !== "string" || secret.length < 1 || secret.length > 4096) {
    throw new Error("Integration secrets must contain 1 to 4096 characters.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: "v1",
  };
};

const decryptSecret = (record) => {
  if (!record?.secret_ciphertext || !record.secret_iv || !record.secret_tag) return null;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.secret_iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.secret_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.secret_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

const signWebhookBody = (secret, body) => createHmac("sha256", secret).update(body).digest("hex");

const verifyWebhookSignature = (secret, body, signature, prefix = "") => {
  if (typeof signature !== "string" || !signature.startsWith(prefix)) return false;
  const supplied = Buffer.from(signature.slice(prefix.length), "hex");
  const expected = Buffer.from(signWebhookBody(secret, body), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

const createWebhookSecret = () => randomBytes(32).toString("base64url");

module.exports = { createWebhookSecret, decryptSecret, encryptSecret, signWebhookBody, verifyWebhookSignature };