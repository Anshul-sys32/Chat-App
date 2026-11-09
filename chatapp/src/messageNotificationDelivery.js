import { Capacitor, registerPlugin } from "@capacitor/core";

const NativeMessageNotifications = registerPlugin("MessageNotifications");

export const requestMessageNotificationPermission = async () => {
  if (Capacitor.isNativePlatform()) {
    const result = await NativeMessageNotifications.requestPermission();
    return Boolean(result?.granted);
  }
  if (!("Notification" in window)) return false;
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  return permission === "granted";
};

export const showSystemNotification = async ({ title, body, notificationId, target }) => {
  if (Capacitor.isNativePlatform()) {
    await NativeMessageNotifications.show({
      title,
      body,
      notificationId,
      targetType: target?.targetType || "",
      targetId: String(target?.targetId || ""),
      targetName: target?.targetName || "",
      targetChannelId: String(target?.targetChannelId || ""),
      targetChannelName: target?.targetChannelName || "",
    });
    return;
  }

  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const notification = new Notification(title, { body, tag: notificationId });
  notification.onclick = () => {
    window.focus();
    notification.close();
    window.dispatchEvent(new CustomEvent("chat-notification-click", { detail: target }));
  };
};
