const DEVICE_KEYS = ["audioInputId", "videoInputId", "audioOutputId"];

const resolveUserId = (userId) => {
  if (userId !== undefined && userId !== null) return String(userId);
  try {
    const user = JSON.parse(localStorage.getItem("user") || "null");
    return String(user?._id ?? user?.id ?? "anonymous");
  } catch {
    return "anonymous";
  }
};

const storageKey = (userId) => `media-device-preferences:${resolveUserId(userId)}`;

export const readMediaDevicePreferences = (userId) => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(userId)) || "{}");
    return Object.fromEntries(DEVICE_KEYS.map((key) => [
      key,
      typeof stored[key] === "string" ? stored[key] : "",
    ]));
  } catch {
    return Object.fromEntries(DEVICE_KEYS.map((key) => [key, ""]));
  }
};

export const saveMediaDevicePreferences = (userId, preferences) => {
  const sanitized = Object.fromEntries(DEVICE_KEYS.map((key) => [
    key,
    typeof preferences[key] === "string" ? preferences[key] : "",
  ]));
  localStorage.setItem(storageKey(userId), JSON.stringify(sanitized));
  return sanitized;
};
