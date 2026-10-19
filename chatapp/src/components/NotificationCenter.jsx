import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { FaBell, FaCheckDouble } from "react-icons/fa";
import Socket from "../Socket";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
  withCredentials: true,
});

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");

  const loadNotifications = useCallback(async () => {
    setError("");
    try {
      const { data } = await axios.get(`${API_URL}/api/notifications`, authConfig());
      setNotifications(data.notifications);
      setUnreadCount(Number(data.unreadCount) || 0);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load notifications.");
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const receiveNotification = (notification) => {
      setNotifications((current) => [
        notification,
        ...current.filter((item) => String(item._id) !== String(notification._id)),
      ].slice(0, 50));
      if (!notification.isRead) setUnreadCount((count) => count + 1);
    };
    Socket.on("notification", receiveNotification);
    return () => Socket.off("notification", receiveNotification);
  }, [loadNotifications]);

  const markRead = async (notificationId) => {
    try {
      const selectedNotification = notifications.find(
        (notification) => String(notification._id) === String(notificationId)
      );
      await axios.patch(
        `${API_URL}/api/notifications/${notificationId}/read`,
        {},
        authConfig()
      );
      setNotifications((current) => current.map((notification) =>
        String(notification._id) === String(notificationId)
          ? { ...notification, isRead: 1 }
          : notification
      ));
      if (selectedNotification && !selectedNotification.isRead) {
        setUnreadCount((count) => Math.max(0, count - 1));
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not update this notification.");
    }
  };

  const markAllRead = async () => {
    try {
      await axios.patch(`${API_URL}/api/notifications/read-all`, {}, authConfig());
      setNotifications((current) => current.map((notification) => ({ ...notification, isRead: 1 })));
      setUnreadCount(0);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not update notifications.");
    }
  };

  return (
    <div className={`relative ${isOpen ? "z-[60]" : ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={isOpen}
        className="chat-action theme-text relative grid h-10 w-10 place-items-center rounded-xl border transition hover:text-teal-500"
      >
        <FaBell />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {isOpen && (
        <section
          aria-label="Notifications"
          className="theme-sidebar absolute right-0 z-[70] mt-2 max-h-[min(75vh,32rem)] w-[min(22rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border p-3 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Notifications</h2>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-xs text-teal-500 hover:underline"
              >
                <FaCheckDouble size={11} /> Mark all read
              </button>
            )}
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-rose-400">{error}</p>}
          {notifications.length === 0 ? (
            <p className="theme-muted py-8 text-center text-sm">You’re all caught up.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {notifications.map((notification) => (
                <li key={notification._id}>
                  <button
                    type="button"
                    onClick={() => !notification.isRead && markRead(notification._id)}
                    className={`w-full rounded-lg border p-3 text-left transition hover:bg-white/5 ${
                      notification.isRead ? "border-white/5 opacity-75" : "border-teal-400/30 bg-teal-400/5"
                    }`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-medium">{notification.title}</span>
                      {!notification.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-400" />}
                    </span>
                    <span className="mt-1 block whitespace-pre-wrap break-words text-sm">{notification.body}</span>
                    <span className="theme-muted mt-2 block text-xs">
                      {notification.senderName || "Administrator"} ·{" "}
                      {new Date(notification.timestamp).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
