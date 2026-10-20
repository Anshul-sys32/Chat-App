const path = require("node:path");
const multer = require("multer");
const { randomUUID } = require("node:crypto");

const uploadDirectory = path.resolve(__dirname, "../uploads");
const maxFileSize = 50 * 1024 * 1024;
const avatarMaxFileSize = 5 * 1024 * 1024;
const allowedAvatarTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"],
]);
const allowedUploadTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"],
  ["audio/mpeg", ".mp3"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/webm", ".webm"],
  ["application/pdf", ".pdf"],
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
      const extension = allowedUploadTypes.get(file.mimetype);
      callback(null, `${req.user.id}-${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: maxFileSize, files: 5 },
  fileFilter: (_req, file, callback) => {
    if (!allowedUploadTypes.has(file.mimetype)) {
      return callback(new Error("Only supported images, video, audio, and PDF files can be sent."));
    }
    return callback(null, true);
  },
});

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (req, file, callback) => {
      const extension = allowedAvatarTypes.get(file.mimetype);
      callback(null, `${req.user.id}-avatar-${randomUUID()}${extension}`);
    },
  }),
  limits: { fileSize: avatarMaxFileSize, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedAvatarTypes.has(file.mimetype)) {
      return callback(new Error("Choose a JPEG, PNG, GIF, WebP, or AVIF image."));
    }
    return callback(null, true);
  },
});

module.exports = {
  upload,
  avatarUpload,
  uploadDirectory,
  allowedUploadTypes,
  maxFileSize,
};
