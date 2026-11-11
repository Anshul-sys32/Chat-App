const Y = require("yjs");
const MAX_CODE_UPDATE_BYTES = 128 * 1024;
const MAX_CODE_SYNC_BYTES = 2 * 1024 * 1024;

const asBuffer = (update) => {
  if (Buffer.isBuffer(update)) return update;
  if (update instanceof Uint8Array) return Buffer.from(update);
  if (Array.isArray(update) && update.length <= MAX_CODE_UPDATE_BYTES
    && update.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return Buffer.from(update);
  }
  return null;
};

const validateCodeUpdate = (update) => {
  const buffer = asBuffer(update);
  if (!buffer || buffer.length < 1 || buffer.length > MAX_CODE_UPDATE_BYTES) return null;
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, buffer);
    return buffer;
  } catch {
    return null;
  } finally {
    document.destroy();
  }
};

const validateAwarenessUpdate = (update) => {
  const buffer = asBuffer(update);
  return buffer && buffer.length > 0 && buffer.length <= 16 * 1024 ? buffer : null;
};

module.exports = { MAX_CODE_SYNC_BYTES, asBuffer, validateAwarenessUpdate, validateCodeUpdate };
