const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("../config/db");
const { voiceDirectory } = require("./uploads");

const maxOrphanAgeMs = 24 * 60 * 60 * 1000;
const voiceFilenamePattern = /^\d+-voice-[a-f0-9-]{36}\.(webm|ogg|m4a|mp3|wav)$/i;

const cleanupAbandonedVoiceUploads = async () => {
  const files = await fs.readdir(voiceDirectory, { withFileTypes: true });
  const cutoff = Date.now() - maxOrphanAgeMs;
  for (const entry of files) {
    if (!entry.isFile() || !voiceFilenamePattern.test(entry.name)) continue;
    const filePath = path.join(voiceDirectory, entry.name);
    const file = await fs.stat(filePath);
    if (file.mtimeMs > cutoff) continue;

    const mediaUrl = `/api/voice-media/${entry.name}`;
    const [[directMessage]] = await pool.execute(
      "SELECT 1 FROM messages WHERE is_deleted = FALSE AND JSON_SEARCH(attachments, 'one', ?) IS NOT NULL LIMIT 1",
      [mediaUrl]
    );
    if (directMessage) continue;
    const [[groupMessage]] = await pool.execute(
      "SELECT 1 FROM group_messages WHERE is_deleted = FALSE AND JSON_SEARCH(attachments, 'one', ?) IS NOT NULL LIMIT 1",
      [mediaUrl]
    );
    if (!groupMessage) await fs.unlink(filePath);
  }
};

module.exports = { cleanupAbandonedVoiceUploads };