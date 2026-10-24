const path = require("node:path");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const sharp = require("sharp");
const { stickerDirectory } = require("./uploads");

const MAX_STICKER_DIMENSION = 256;
const MAX_STICKER_OUTPUT_BYTES = 400 * 1024;

const optimizeSticker = async (buffer) => {
	const image = sharp(buffer, {
		animated: true,
		failOn: "error",
		limitInputPixels: 40_000_000,
	});
	const metadata = await image.metadata();
	if (!metadata.format || !["jpeg", "png", "gif", "webp", "avif"].includes(metadata.format)) {
		throw new Error("Sticker must be a JPEG, PNG, GIF, WebP, or AVIF image.");
	}
	if ((metadata.pages || 1) > 100 || metadata.width * metadata.height * (metadata.pages || 1) > 40_000_000) {
		throw new Error("Sticker animations must contain 100 frames or fewer and stay under 40 megapixels total.");
	}
	const optimized = await image
		.resize({
			width: MAX_STICKER_DIMENSION,
			height: MAX_STICKER_DIMENSION,
			fit: "inside",
			withoutEnlargement: true,
		})
		.webp({ quality: 72, effort: 4, loop: 0 })
		.toBuffer();
	if (optimized.length > MAX_STICKER_OUTPUT_BYTES) {
		throw new Error("Optimized sticker must be 400 KB or smaller.");
	}
	return { buffer: optimized, animated: (metadata.pages || 1) > 1 };
};

const storeSticker = async (buffer) => {
	await fs.mkdir(stickerDirectory, { recursive: true });
	const filename = `${randomUUID()}.webp`;
	const filePath = path.join(stickerDirectory, filename);
	await fs.writeFile(filePath, buffer, { flag: "wx" });
	return { filename, url: `/uploads/stickers/${filename}`, filePath };
};

const removeStickerFile = async (url) => {
	if (typeof url !== "string") return;
	const match = /^\/uploads\/stickers\/([a-f0-9-]{36})\.webp$/i.exec(url);
	if (!match) return;
	await fs.unlink(path.join(stickerDirectory, `${match[1]}.webp`)).catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
};

module.exports = { optimizeSticker, storeSticker, removeStickerFile };
