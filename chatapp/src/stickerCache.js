import axios from "axios";

const DATABASE_NAME = "nfang-sticker-cache";
const DATABASE_VERSION = 1;
const CATALOG_STORE = "catalog";
const ASSET_STORE = "assets";
const META_STORE = "meta";

const openDatabase = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) {
    reject(new Error("IndexedDB is unavailable."));
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(CATALOG_STORE)) database.createObjectStore(CATALOG_STORE, { keyPath: "_id" });
    if (!database.objectStoreNames.contains(ASSET_STORE)) database.createObjectStore(ASSET_STORE, { keyPath: "url" });
    if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: "key" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const requestValue = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readStore = async (storeName, mode, callback) => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    const result = await callback(transaction.objectStore(storeName));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    database.close();
  }
};

const listValues = (storeName) => readStore(storeName, "readonly", (store) => requestValue(store.getAll()));
const getValue = (storeName, key) => readStore(storeName, "readonly", (store) => requestValue(store.get(key)));
const putValue = (storeName, value) => readStore(storeName, "readwrite", (store) => requestValue(store.put(value)));
const saveCatalog = async (stickers, categories, revision) => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([CATALOG_STORE, ASSET_STORE, META_STORE], "readwrite");
    const catalog = transaction.objectStore(CATALOG_STORE);
    catalog.clear();
    stickers.forEach((sticker) => catalog.put(sticker));
    const assets = transaction.objectStore(ASSET_STORE);
    const currentUrls = new Set(stickers.map((sticker) => sticker.imageUrl));
    const keysRequest = assets.getAllKeys();
    keysRequest.onsuccess = () => keysRequest.result.forEach((url) => {
      if (!currentUrls.has(url)) assets.delete(url);
    });
    const meta = transaction.objectStore(META_STORE);
    meta.put({ key: "categories", value: categories });
    if (revision !== undefined) meta.put({ key: "revision", value: revision });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

const loadCachedCatalog = async () => {
  try {
    const [stickers, revisionEntry, categoriesEntry] = await Promise.all([
      listValues(CATALOG_STORE),
      getValue(META_STORE, "revision"),
      getValue(META_STORE, "categories"),
    ]);
    return { stickers, revision: revisionEntry?.value || null, categories: categoriesEntry?.value || ["General"] };
  } catch {
    return { stickers: [], revision: null, categories: ["General"] };
  }
};

const mapLimit = async (items, limit, worker) => {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  }));
};

const buildSources = async (stickers, existingSources = {}) => {
  const sources = {};
  await Promise.all(stickers.map(async (sticker) => {
    if (existingSources[sticker.imageUrl]) {
      sources[sticker.imageUrl] = existingSources[sticker.imageUrl];
      return;
    }
    const cached = await getValue(ASSET_STORE, sticker.imageUrl);
    if (cached?.blob) sources[sticker.imageUrl] = URL.createObjectURL(cached.blob);
  }));
  return sources;
};

export const releaseStickerSources = (sources) => Object.values(sources || {}).forEach((url) => URL.revokeObjectURL(url));

export const loadStickerCatalog = async (apiUrl, token, existingSources = {}) => {
  const cached = await loadCachedCatalog();
  let catalog = cached;
  let revisionConfirmed = false;
  try {
    const headers = { Authorization: `Bearer ${token || ""}` };
    if (cached.revision) headers["If-None-Match"] = `"stickers-${cached.revision}"`;
    const response = await axios.get(`${apiUrl}/api/stickers`, {
      headers,
      withCredentials: true,
      validateStatus: (status) => status < 400 || status === 304,
    });
    if (response.status === 304) {
      revisionConfirmed = true;
    } else {
      const remote = response.data || {};
      catalog = {
        stickers: Array.isArray(remote.stickers) ? remote.stickers : [],
        categories: Array.isArray(remote.categories) ? remote.categories : ["General"],
        revision: remote.revision || null,
      };
      const cachedById = new Map(cached.stickers.map((sticker) => [String(sticker._id), sticker]));
      const pending = [];
      await Promise.all(catalog.stickers.map(async (sticker) => {
        const previous = cachedById.get(String(sticker._id));
        const asset = await getValue(ASSET_STORE, sticker.imageUrl).catch(() => null);
        if (!previous || previous.imageUrl !== sticker.imageUrl || !asset?.blob) pending.push(sticker);
      }));
      let allAssetsCached = true;
      await mapLimit(pending, 4, async (sticker) => {
        try {
          const image = await axios.get(`${apiUrl}${sticker.imageUrl}`, { responseType: "blob", withCredentials: true });
          await putValue(ASSET_STORE, { url: sticker.imageUrl, blob: image.data, mediaType: sticker.mediaType || image.data.type });
        } catch {
          allAssetsCached = false;
        }
      });
      await saveCatalog(catalog.stickers, catalog.categories, allAssetsCached ? catalog.revision : cached.revision)
        .catch(() => {});
      revisionConfirmed = allAssetsCached;
    }
  } catch {
    catalog = cached;
  }
  const sources = await buildSources(catalog.stickers, existingSources).catch(() => ({}));
  return { ...catalog, sources, revisionConfirmed };
};

export const cacheStickerAsset = async (sticker) => {
  if (!sticker?.imageUrl || !sticker?.blob) return;
  await putValue(ASSET_STORE, { url: sticker.imageUrl, blob: sticker.blob, mediaType: sticker.mediaType || sticker.blob.type });
};
