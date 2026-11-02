import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { FaBell, FaCheck, FaCheckDouble, FaCog, FaTimes, FaVolumeUp } from "react-icons/fa";
import Socket from "../Socket";
import { requestMessageNotificationPermission, showSystemNotification } from "../messageNotificationDelivery";
import FloatingPanel from "./FloatingPanel";
import useFloatingPanel from "../useFloatingPanel";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
  withCredentials: true,
});
const DEFAULT_PREFERENCES = {
  browserNotifications: false,
  notificationSounds: false,
  directMessages: true,
  groupMessages: true,
};

export default function NotificationCenter({ onNavigate }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [error, setError] = useState("");
  const { triggerRef, panelRef, style: panelStyle } = useFloatingPanel(isOpen, () => setIsOpen(false));
  const preferencesRef = useRef(preferences);
  const notificationsRef = useRef(notifications);
  const receivedNotificationIdsRef = useRef(new Set());
  const audioContextRef = useRef(null);
  const onNavigateRef = useRef(onNavigate);
  preferencesRef.current = preferences;
  notificationsRef.current = notifications;
  onNavigateRef.current = onNavigate;

  const loadNotifications = useCallback(async () => {
    setError("");
    try {
      const { data } = await axios.get(`${API_URL}/api/notifications`, authConfig());
      setNotifications(data.notifications);
      data.notifications.forEach((notification) => {
        receivedNotificationIdsRef.current.add(String(notification._id));
      });
      setUnreadCount(Number(data.unreadCount) || 0);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load notifications.");
    }
  }, []);

  const playNotificationSound = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    try {
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      const play = () => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(740, context.currentTime);
        oscillator.frequency.setValueAtTime(980, context.currentTime + 0.09);
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.21);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      };
      if (context.state === "suspended") context.resume().then(play).catch(() => {});
      else play();
      return true;
    } catch {
      return false;
    }
  };

  const updatePreference = async (preference, enabled) => {
    setError("");
    if (preference === "browserNotifications" && enabled) {
      try {
        const granted = await requestMessageNotificationPermission();
        if (!granted) {
          setError("System notification permission was not granted. Check this app’s notification settings.");
          return;
        }
      } catch (permissionError) {
        setError(permissionError.message || "Could not request system notification permission.");
        return;
      }
    }
    if (preference === "notificationSounds" && enabled) playNotificationSound();
    try {
      const { data } = await axios.patch(
        `${API_URL}/api/notifications/preferences`,
        { [preference]: enabled },
        authConfig()
      );
      setPreferences(data.preferences);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not save notification preferences.");
    }
  };

  useEffect(() => {
    loadNotifications();
    axios.get(`${API_URL}/api/notifications/preferences`, authConfig())
      .then(({ data }) => setPreferences(data.preferences))
      .catch((requestError) => {
        setError(requestError.response?.data?.message || "Could not load notification preferences.");
      })
      .finally(() => setPreferencesLoading(false));
    const receiveNotification = (notification) => {
      if (["direct_message", "group_message"].includes(notification?.category)) return;
      const notificationId = String(notification?._id || "");
      const isInvitationUpdate = notification?.category === "group_invite" && notification?.invitationStatus !== "pending";
      if (notificationId && receivedNotificationIdsRef.current.has(notificationId) && !isInvitationUpdate) return;
      if (notificationId) receivedNotificationIdsRef.current.add(notificationId);
      const existing = notificationsRef.current.find((item) => String(item._id) === String(notification._id));
      if (!notification.isRead && !existing?.isRead) setUnreadCount((count) => count + 1);
      if (notification.isRead && existing && !existing.isRead) setUnreadCount((count) => Math.max(0, count - 1));
      setNotifications((current) => [notification, ...current.filter((item) => String(item._id) !== String(notification._id))].slice(0, 50));
      if (document.visibilityState === "hidden" && preferencesRef.current.browserNotifications) {
        showSystemNotification({
          title: notification.title,
          body: notification.body,
          notificationId,
          target: {
            targetType: notification.targetType,
            targetId: notification.targetId,
            targetName: notification.targetName,
            targetChannelId: notification.targetChannelId,
            targetChannelName: notification.targetChannelName,
          },
        }).catch((notificationError) => {
          console.warn("Could not show a system alert:", notificationError.message);
        });
      }
      if (preferencesRef.current.notificationSounds) playNotificationSound();
    };
    const showMessageNotification = async (notification, preference) => {
      if (!preferencesRef.current.browserNotifications || !preferencesRef.current[preference]
        || document.visibilityState !== "hidden") return;
      try {
        await showSystemNotification({
          ...notification,
          target: {
            targetType: notification.targetType,
            targetId: notification.targetId,
            targetName: notification.targetName,
            targetChannelId: notification.targetChannelId,
            targetChannelName: notification.targetChannelName,
          },
        });
        if (preferencesRef.current.notificationSounds) playNotificationSound();
      } catch (notificationError) {
        console.warn("Could not show a chat system notification:", notificationError.message);
      }
    };
    const receiveDirectMessage = (notification) => showMessageNotification(notification, "directMessages");
    const receiveGroupMessage = (notification) => showMessageNotification(notification, "groupMessages");
    const handleNotificationClick = (event) => {
      const target = event.detail;
      if (target?.targetType && target?.targetId) onNavigateRef.current?.(target);
    };
    Socket.on("notification", receiveNotification);
    Socket.on("direct-message-notification", receiveDirectMessage);
    Socket.on("group-message-notification", receiveGroupMessage);
    window.addEventListener("chat-notification-click", handleNotificationClick);
    return () => {
      Socket.off("notification", receiveNotification);
      Socket.off("direct-message-notification", receiveDirectMessage);
      Socket.off("group-message-notification", receiveGroupMessage);
      window.removeEventListener("chat-notification-click", handleNotificationClick);
    };
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

  const openNotification = async (notification) => {
    if (!notification.isRead) await markRead(notification._id);
    if (notification.targetType && notification.targetId) {
      onNavigate?.({
        targetType: notification.targetType,
        targetId: notification.targetId,
        targetName: notification.targetName,
        targetChannelId: notification.targetChannelId,
        targetChannelName: notification.targetChannelName,
      });
    }
    setIsOpen(false);
  };

  const respondToGroupInvite = async (notification, action) => {
    try {
      await axios.patch(
        `${API_URL}/api/notifications/${notification._id}/group-invite`,
        { action },
        authConfig()
      );
      setNotifications((current) => current.map((item) => String(item._id) === String(notification._id)
        ? {
          ...item,
          isRead: 1,
          title: action === "accept" ? `You are now a member of ${item.targetName}` : `You rejected the invitation to ${item.targetName}`,
          body: action === "accept" ? "The group is now available in your sidebar." : "The invitation has been rejected.",
          invitationStatus: action === "accept" ? "accepted" : "rejected",
        }
        : item
      ));
      if (!notification.isRead) setUnreadCount((count) => Math.max(0, count - 1));
      if (action === "accept") {
        onNavigate?.({ targetType: "group", targetId: notification.targetId, targetName: notification.targetName });
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not respond to this invitation.");
    }
  };

  const respondToMeetingInvite = async (notification, action) => {
    try {
      const { data } = await axios.patch(
        `${API_URL}/api/notifications/${notification._id}/meeting-invite`,
        { action },
        authConfig()
      );
      const status = data.status;
      setNotifications((current) => current.map((item) => String(item._id) === String(notification._id)
        ? { ...item, isRead: 1, invitationStatus: status, title: status === "accepted" ? `You accepted ${item.targetName}` : `You declined ${item.targetName}` }
        : item
      ));
      if (!notification.isRead) setUnreadCount((count) => Math.max(0, count - 1));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not respond to this meeting invitation.");
    }
  };

  return (
    <div className={`relative ${isOpen ? "z-[60]" : ""}`}>
      <button
      ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={isOpen}
        className="chat-action theme-text relative inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm transition hover:text-teal-500"
      >
        <FaBell />
        <span>Alerts</span>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      <FloatingPanel
        open={isOpen}
        triggerRef={triggerRef}
        panelRef={panelRef}
        style={panelStyle}
        className="notification-panel-enter theme-popover w-[min(22rem,calc(100vw-1rem))] rounded-xl border p-3 shadow-2xl"
      >
        <section
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Notifications</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsSettingsOpen((open) => !open)}
                aria-label="Notification settings"
                aria-expanded={isSettingsOpen}
                title="Notification settings"
                className="theme-muted hover:text-teal-500"
              >
                <FaCog />
              </button>
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
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-rose-400">{error}</p>}
          {isSettingsOpen && (
            <div aria-label="Notification preferences" className="mt-3 space-y-3 border-y border-white/10 py-3">
              <p className="theme-muted text-xs font-semibold uppercase">Chat system notifications</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={preferences.directMessages} disabled={preferencesLoading} onChange={(event) => updatePreference("directMessages", event.target.checked)} className="accent-teal-500" />
                Direct messages
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={preferences.groupMessages} disabled={preferencesLoading} onChange={(event) => updatePreference("groupMessages", event.target.checked)} className="accent-teal-500" />
                Group messages
              </label>
              <p className="theme-muted text-xs font-semibold uppercase">Delivery</p>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={preferences.browserNotifications}
                  disabled={preferencesLoading}
                  onChange={(event) => updatePreference("browserNotifications", event.target.checked)}
                  className="mt-1 accent-teal-500"
                />
                <span>
                  System notifications
                  <span className="theme-muted mt-0.5 block text-xs">Show chat notifications while this app is in the background.</span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={preferences.notificationSounds}
                  disabled={preferencesLoading}
                  onChange={(event) => updatePreference("notificationSounds", event.target.checked)}
                  className="accent-teal-500"
                />
                Notification sounds
              </label>
              <button
                type="button"
                onClick={playNotificationSound}
                disabled={preferencesLoading}
                className="inline-flex items-center gap-2 text-xs text-teal-500 hover:underline disabled:opacity-50"
              >
                <FaVolumeUp /> Preview sound
              </button>
            </div>
          )}
          {notifications.length === 0 ? (
            <p className="theme-muted py-8 text-center text-sm">You’re all caught up.</p>
          ) : (
            <ul className="mt-2 space-y-2">
                {notifications.map((notification, index) => (
                  <NotificationItem
                    key={notification._id}
                    notification={notification}
                    index={index}
                    onOpen={openNotification}
                    onRespond={respondToGroupInvite}
                    onMeetingRespond={respondToMeetingInvite}
                  />
                ))}
            </ul>
          )}
        </section>
      </FloatingPanel>
    </div>
  );
}

function NotificationItem({ notification, index, onOpen, onRespond, onMeetingRespond }) {
  const isInvite = notification.category === "group_invite";
  const isPendingInvite = isInvite && notification.invitationStatus === "pending";
  const isPendingMeetingInvite = notification.category === "meeting_invite" && notification.invitationStatus === "invited";
  const content = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="font-medium">{notification.title}</span>
        {!notification.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-400" />}
      </span>
      <span className="mt-1 block whitespace-pre-wrap break-words text-sm">{notification.body}</span>
      <span className="theme-muted mt-2 block text-xs">
        {notification.senderName || "Administrator"} · {notification.timestamp ? new Date(notification.timestamp).toLocaleString() : ""}
      </span>
    </>
  );

  return (
    <li style={{ "--notification-index": Math.min(index, 8) }} className="notification-item-enter">
      {isPendingInvite || isPendingMeetingInvite ? (
        <div className="w-full rounded-lg border border-teal-400/30 bg-teal-400/5 p-3">
          {content}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => isPendingInvite ? onRespond(notification, "accept") : onMeetingRespond(notification, "accept")} className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"><FaCheck /> Accept</button>
            <button type="button" onClick={() => isPendingInvite ? onRespond(notification, "reject") : onMeetingRespond(notification, "decline")} className="inline-flex items-center gap-1 rounded-md border border-rose-300/30 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10"><FaTimes /> {isPendingInvite ? "Reject" : "Decline"}</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => onOpen(notification)} className={`w-full rounded-lg border p-3 text-left transition hover:bg-white/5 ${notification.isRead ? "border-white/5 opacity-75" : "border-teal-400/30 bg-teal-400/5"}`}>
          {content}
        </button>
      )}
    </li>
  );
}
