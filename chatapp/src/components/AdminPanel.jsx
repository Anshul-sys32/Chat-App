import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { FaCheck, FaEdit, FaTrash } from "react-icons/fa";
import GroupList from "./GroupList";
import ProfileEditor from "./ProfileEditor";
import NotificationCenter from "./NotificationCenter";
import Avatar from "./Avatar";
import Socket from "../Socket";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
  withCredentials: true,
});

export default function AdminPanel({ user, onBack, onUserUpdated }) {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState(null);
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationBody, setNotificationBody] = useState("");
  const [notificationAudience, setNotificationAudience] = useState("all");
  const [notificationRecipients, setNotificationRecipients] = useState([]);
  const [sendingNotification, setSendingNotification] = useState(false);
  const [notificationSuccess, setNotificationSuccess] = useState("");

  const loadUsers = useCallback(async () => {
    setError("");
    try {
      const { data } = await axios.get(`${API_URL}/api/admin/users`, authConfig());
      setUsers(data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const handleProfilePicture = ({ userId, profilePicture }) => {
      setUsers((previous) => previous.map((candidate) =>
        String(candidate._id) === String(userId) ? { ...candidate, profilePicture } : candidate
      ));
    };
    Socket.on("profile-picture-updated", handleProfilePicture);
    return () => Socket.off("profile-picture-updated", handleProfilePicture);
  }, []);

  const updateUser = async (target, updates) => {
    setError("");
    try {
      const { data } = await axios.patch(
        `${API_URL}/api/admin/users/${target._id}`,
        { role: updates.role ?? target.role, status: updates.status ?? target.status },
        authConfig()
      );
      setUsers((previous) => previous.map((candidate) =>
        String(candidate._id) === String(target._id) ? { ...candidate, ...data } : candidate
      ));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not update this user.");
    }
  };

  const deleteUser = async (target) => {
    if (!window.confirm(`Permanently delete ${target.username} and their account data?`)) return;
    setError("");
    try {
      await axios.delete(`${API_URL}/api/admin/users/${target._id}`, authConfig());
      setUsers((previous) => previous.filter((candidate) => String(candidate._id) !== String(target._id)));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not delete this user.");
    }
  };

  const sendNotification = async (event) => {
    event.preventDefault();
    setError("");
    setNotificationSuccess("");
    setSendingNotification(true);
    try {
      const { data } = await axios.post(
        `${API_URL}/api/admin/notifications`,
        {
          title: notificationTitle,
          body: notificationBody,
          audience: notificationAudience,
          ...(notificationAudience === "selected" ? { recipientIds: notificationRecipients } : {}),
        },
        authConfig()
      );
      setNotificationSuccess(`Notification sent to ${data.sent} user${data.sent === 1 ? "" : "s"}.`);
      setNotificationTitle("");
      setNotificationBody("");
      setNotificationRecipients([]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not send the notification.");
    } finally {
      setSendingNotification(false);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 text-white sm:px-8">
      <div className="glass-panel mx-auto max-w-5xl rounded-2xl p-4 sm:p-6">
        <div className="relative z-30 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Administration</h1>
            <p className="mt-1 text-sm text-white/60">Approve accounts and manage user access and roles.</p>
          </div>
          <div className="flex items-center gap-3">
            <NotificationCenter />
            <button type="button" onClick={onBack || (() => navigate("/chat"))} className="rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10">
              Back to chat
            </button>
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg bg-rose-950/70 px-4 py-3 text-sm text-rose-200">{error}</p>}
        <section className="glass-panel mt-6 rounded-xl p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Send a notification</h2>
          <p className="mt-1 text-sm text-white/60">Notify all active users or choose specific recipients.</p>
          {notificationSuccess && (
            <p role="status" className="mt-3 rounded-lg bg-emerald-950/50 px-3 py-2 text-sm text-emerald-200">
              {notificationSuccess}
            </p>
          )}
          <form onSubmit={sendNotification} className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-white/70">Title</span>
              <input
                value={notificationTitle}
                onChange={(event) => setNotificationTitle(event.target.value)}
                maxLength={120}
                required
                className="w-full rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-white outline-none focus:border-teal-300/60"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-white/70">Message</span>
              <textarea
                value={notificationBody}
                onChange={(event) => setNotificationBody(event.target.value)}
                maxLength={2000}
                rows={3}
                required
                className="w-full resize-y rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-white outline-none focus:border-teal-300/60"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-white/70">Recipients</span>
              <select
                value={notificationAudience}
                onChange={(event) => setNotificationAudience(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-white"
              >
                <option value="all">Everyone (active users)</option>
                <option value="selected">Specific users</option>
              </select>
            </label>
            {notificationAudience === "selected" && (
              <label className="block text-sm">
                <span className="mb-1 block text-white/70">Choose users (Ctrl/Cmd-click to select multiple)</span>
                <select
                  multiple
                  value={notificationRecipients}
                  onChange={(event) => setNotificationRecipients(
                    Array.from(event.target.selectedOptions, (option) => option.value)
                  )}
                  className="max-h-48 w-full rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-white"
                >
                  {users.filter((candidate) => candidate.status === "active").map((candidate) => (
                    <option key={candidate._id} value={candidate._id}>
                      {candidate.username} ({candidate.email})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="submit"
              disabled={sendingNotification || (notificationAudience === "selected" && !notificationRecipients.length)}
              className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-[#062a27] transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sendingNotification ? "Sending…" : "Send notification"}
            </button>
          </form>
        </section>
        {loading ? <p className="mt-6 text-sm text-white/60">Loading users…</p> : (
          <div className="mt-6 space-y-3">
            {users.map((candidate) => {
              const isSelf = String(candidate._id) === String(user?._id);
              return (
                <section key={candidate._id} className="glass-panel flex flex-col gap-4 rounded-xl p-4 sm:flex-row sm:items-center">
                  <Avatar src={candidate.profilePicture || candidate.googlePicture} name={candidate.username} className="h-11 w-11 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{candidate.username}{isSelf ? " (you)" : ""}</p>
                    <p className="truncate text-sm text-white/55">{candidate.email}</p>
                  </div>
                  <span className={`text-xs font-semibold uppercase ${candidate.status === "active" ? "text-emerald-300" : candidate.status === "pending" ? "text-amber-200" : "text-rose-300"}`}>
                    {candidate.status}
                  </span>
                  <label className="flex items-center gap-2 text-xs text-white/60">
                    Role
                    <select
                      value={candidate.role}
                      disabled={isSelf}
                      onChange={(event) => updateUser(candidate, { role: event.target.value })}
                      className="rounded-md border border-white/10 bg-[#142d32] px-2 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      <option value="user">User</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                      <option value="guest">Guest</option>
                    </select>
                  </label>
                  {candidate.status === "pending" ? (
                    <button
                      type="button"
                      onClick={() => updateUser(candidate, { status: "active" })}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500"
                    >
                      <FaCheck size={12} /> Approve
                    </button>
                  ) : (
                    <label className="flex items-center gap-2 text-xs text-white/60">
                      Status
                      <select
                        value={candidate.status}
                        disabled={isSelf}
                        onChange={(event) => updateUser(candidate, { status: event.target.value })}
                        className="rounded-md border border-white/10 bg-[#142d32] px-2 py-1.5 text-sm text-white disabled:opacity-50"
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="pending">Pending</option>
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingUser(candidate)}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-teal-200/20 px-3 py-2 text-sm text-teal-100 transition hover:bg-teal-300/10"
                    title={`Edit ${candidate.username}'s profile or password`}
                  >
                    <FaEdit size={12} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteUser(candidate)}
                    disabled={isSelf}
                    title={`Delete ${candidate.username}`}
                    aria-label={`Delete ${candidate.username}`}
                    className="grid h-9 w-9 place-items-center self-end rounded-md text-rose-300 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-30 sm:self-auto"
                  >
                    <FaTrash size={13} />
                  </button>
                </section>
              );
            })}
            {users.length === 0 && <p className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-white/50">No users found.</p>}
          </div>
        )}
        <section className="glass-panel mt-10 rounded-xl p-4">
          <h2 className="mb-4 text-lg font-semibold">Group management</h2>
          <GroupList />
        </section>
      </div>
      {editingUser && (
        <ProfileEditor
          user={editingUser}
          isAdmin
          onClose={() => setEditingUser(null)}
          onSaved={(updatedUser) => {
            setUsers((previous) => previous.map((candidate) =>
              String(candidate._id) === String(updatedUser._id) ? { ...candidate, ...updatedUser } : candidate
            ));
            if (String(updatedUser._id) === String(user?._id)) onUserUpdated?.(updatedUser);
          }}
        />
      )}
    </main>
  );
}
