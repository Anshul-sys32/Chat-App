export const getMessageNotificationActions = ({
  categoryEnabled,
  isHidden,
  browserNotifications,
  notificationSounds,
}) => ({
  showSystemNotification: Boolean(categoryEnabled && isHidden && browserNotifications),
  playSound: Boolean(categoryEnabled && isHidden && notificationSounds),
});

export const createNotificationIdDeduper = (maxEntries = 512) => {
  const seenIds = new Set();
  return (notificationId) => {
    const id = String(notificationId || "");
    if (!id) return true;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    if (seenIds.size > maxEntries) seenIds.delete(seenIds.values().next().value);
    return true;
  };
};

export const normalizeNotificationTarget = (target) => {
  const id = Number(target?.targetId);
  if (!Number.isSafeInteger(id) || id < 1) return null;

  if (target.targetType === "group" || target.targetType === "channel") {
    const channelId = Number(target.targetChannelId);
    const hasChannel = Number.isSafeInteger(channelId) && channelId > 0;
    return {
      _id: id,
      type: "group",
      name: target.targetName || "Group",
      ...(hasChannel ? {
        channelId,
        channelName: target.targetChannelName || "Channel",
      } : {}),
    };
  }

  if (target.targetType === "direct") {
    return { _id: id, type: "user", username: target.targetName || "User" };
  }

  return null;
};