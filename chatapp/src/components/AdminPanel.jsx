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
  const [notificationRecipientQuery, setNotificationRecipientQuery] = useState("");
  const [notificationRecipientMatches, setNotificationRecipientMatches] = useState([]);
  const [sendingNotification, setSendingNotification] = useState(false);
  const [notificationSuccess, setNotificationSuccess] = useState("");
  const [loginQuotes, setLoginQuotes] = useState([]);
  const [newQuote, setNewQuote] = useState("");
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [editingQuoteText, setEditingQuoteText] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [stickers, setStickers] = useState([]);
  const [stickerCategories, setStickerCategories] = useState(["General"]);
  const [stickerName, setStickerName] = useState("");
  const [stickerCategory, setStickerCategory] = useState("General");
  const [newStickerCategory, setNewStickerCategory] = useState("");
  const [stickerFile, setStickerFile] = useState(null);

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
    if (notificationAudience !== "selected") return;
    const names = notificationRecipientQuery.split(",").map((name) => name.trim()).filter(Boolean);
    if (!names.length) {
      setNotificationRecipientMatches(users.filter((candidate) => candidate.status === "active"));
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const { data } = await axios.get(
          `${API_URL}/api/admin/users?names=${encodeURIComponent(names.join(","))}`,
          authConfig()
        );
        if (active) setNotificationRecipientMatches(data);
      } catch (requestError) {
        if (active) setError(requestError.response?.data?.message || "Could not search recipients.");
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [notificationAudience, notificationRecipientQuery, users]);

  useEffect(() => {
    let active = true;
    axios.get(`${API_URL}/api/admin/login-quotes`, authConfig())
      .then(({ data }) => {
        if (active) setLoginQuotes(data);
      })
      .catch((requestError) => {
        if (active) setQuoteError(requestError.response?.data?.message || "Could not load login quotes.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    axios.get(`${API_URL}/api/stickers`, authConfig())
      .then(({ data }) => {
        setStickers(data.stickers || []);
        setStickerCategories(data.categories || ["General"]);
      })
      .catch((requestError) => setError(requestError.response?.data?.message || "Could not load stickers."));
  }, []);

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
      setNotificationRecipientQuery("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not send the notification.");
    } finally {
      setSendingNotification(false);
    }
  };

  const addLoginQuote = async (event) => {
    event.preventDefault();
    setQuoteError("");
    try {
      const { data } = await axios.post(
        `${API_URL}/api/admin/login-quotes`,
        { quote: newQuote },
        authConfig()
      );
      setLoginQuotes((previous) => [...previous, data]);
      setNewQuote("");
    } catch (requestError) {
      setQuoteError(requestError.response?.data?.message || "Could not add login quote.");
    }
  };

  const saveLoginQuote = async (quoteId) => {
    setQuoteError("");
    try {
      const { data } = await axios.patch(
        `${API_URL}/api/admin/login-quotes/${quoteId}`,
        { quote: editingQuoteText },
        authConfig()
      );
      setLoginQuotes((previous) => previous.map((quote) =>
        String(quote._id) === String(quoteId) ? data : quote
      ));
      setEditingQuoteId(null);
      setEditingQuoteText("");
    } catch (requestError) {
      setQuoteError(requestError.response?.data?.message || "Could not update login quote.");
    }
  };

  const deleteLoginQuote = async (quote) => {
    setQuoteError("");
    try {
      await axios.delete(`${API_URL}/api/admin/login-quotes/${quote._id}`, authConfig());
      setLoginQuotes((previous) => previous.filter((item) => String(item._id) !== String(quote._id)));
      if (String(editingQuoteId) === String(quote._id)) setEditingQuoteId(null);
    } catch (requestError) {
      setQuoteError(requestError.response?.data?.message || "Could not delete login quote.");
    }
  };

  const addSticker = async (event) => {
    event.preventDefault();
    if (!stickerFile) {
      setError("Choose an image or GIF file for the sticker.");
      return;
    }
    if (stickerFile.size > 8 * 1024 * 1024) {
      setError("Sticker files must be 8 MB or smaller.");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("name", stickerName.trim());
      formData.append("category", stickerCategory);
      formData.append("sticker", stickerFile);
      await axios.post(`${API_URL}/api/admin/stickers`, formData, authConfig());
      const { data } = await axios.get(`${API_URL}/api/stickers`, authConfig());
      setStickers(data.stickers || []);
      setStickerCategories(data.categories || ["General"]);
      setStickerName("");
      setStickerFile(null);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not add sticker.");
    }
  };

  const addStickerCategory = async () => {
    const name = newStickerCategory.trim();
    if (!name) return;
    try {
      const { data } = await axios.post(`${API_URL}/api/sticker-categories`, { name }, authConfig());
      const { data: catalog } = await axios.get(`${API_URL}/api/stickers`, authConfig());
      setStickers(catalog.stickers || []);
      setStickerCategories(catalog.categories || ["General"]);
      setStickerCategory(data.name);
      setNewStickerCategory("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not create sticker category.");
    }
  };

  const deleteSticker = async (sticker) => {
    try {
      await axios.delete(`${API_URL}/api/admin/stickers/${sticker._id}`, authConfig());
      setStickers((current) => current.filter((item) => String(item._id) !== String(sticker._id)));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not remove sticker.");
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
                <span className="mb-1 block text-white/70">Search usernames (separate multiple names with commas)</span>
                <input
                  value={notificationRecipientQuery}
                  onChange={(event) => setNotificationRecipientQuery(event.target.value)}
                  placeholder="alice, bob, charlie"
                  className="mb-2 w-full rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-white outline-none focus:border-teal-300/60"
                />
                <select
                  multiple
                  value={notificationRecipients}
                  onChange={(event) => setNotificationRecipients(
                    Array.from(event.target.selectedOptions, (option) => option.value)
                  )}
                  className="max-h-48 w-full rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-white"
                >
                  {notificationRecipientMatches.map((candidate) => (
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
        <section className="glass-panel mt-6 rounded-xl p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Login page quotes</h2>
          <p className="mt-1 text-sm text-white/60">Add, edit, or remove the quotes shown beneath NFaNG. Quotes rotate on the sign-in page.</p>
          <form onSubmit={addLoginQuote} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <textarea
              value={newQuote}
              onChange={(event) => setNewQuote(event.target.value)}
              maxLength={500}
              rows={2}
              required
              placeholder="Write a quote to show on the sign-in page"
              aria-label="New login quote"
              className="min-w-0 flex-1 resize-y rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-white outline-none focus:border-teal-300/60"
            />
            <button
              type="submit"
              disabled={!newQuote.trim()}
              className="self-end rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-[#062a27] transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add quote
            </button>
          </form>
          {quoteError && <p role="alert" className="mt-3 text-sm text-rose-300">{quoteError}</p>}
          <ul className="mt-4 space-y-2">
            {loginQuotes.map((quote) => (
              <li key={quote._id} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.035] p-3 sm:flex-row sm:items-center">
                {String(editingQuoteId) === String(quote._id) ? (
                  <textarea
                    value={editingQuoteText}
                    onChange={(event) => setEditingQuoteText(event.target.value)}
                    maxLength={500}
                    rows={2}
                    aria-label="Edit login quote"
                    className="min-w-0 flex-1 resize-y rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-sm text-white outline-none focus:border-teal-300/60"
                  />
                ) : (
                  <p className="min-w-0 flex-1 text-sm text-white/80">“{quote.quote}”</p>
                )}
                <div className="flex shrink-0 gap-2">
                  {String(editingQuoteId) === String(quote._id) ? (
                    <>
                      <button type="button" onClick={() => saveLoginQuote(quote._id)} disabled={!editingQuoteText.trim()} className="rounded-md border border-teal-200/20 px-3 py-1.5 text-xs text-teal-100 hover:bg-teal-300/10 disabled:opacity-50">Save</button>
                      <button type="button" onClick={() => setEditingQuoteId(null)} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">Cancel</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => { setEditingQuoteId(quote._id); setEditingQuoteText(quote.quote); }} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10">Edit</button>
                  )}
                  <button type="button" onClick={() => deleteLoginQuote(quote)} className="rounded-md border border-rose-300/20 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-500/10">Remove</button>
                </div>
              </li>
            ))}
            {loginQuotes.length === 0 && <li className="rounded-lg border border-dashed border-white/15 px-3 py-5 text-center text-sm text-white/50">No login quotes yet.</li>}
          </ul>
        </section>
        <section className="glass-panel mt-6 rounded-xl p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Custom stickers</h2>
          <p className="mt-1 text-sm text-white/60">Upload an image or GIF. Stickers are resized, compressed, and shared with web and Android clients.</p>
          <form onSubmit={addSticker} className="mt-4 grid gap-2 sm:grid-cols-2">
            <input value={stickerName} onChange={(event) => setStickerName(event.target.value)} required maxLength={100} placeholder="Sticker name" className="rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-sm text-white outline-none" />
            <select value={stickerCategory} onChange={(event) => setStickerCategory(event.target.value)} className="rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-sm text-white">
              {stickerCategories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
            <input type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/avif" onChange={(event) => setStickerFile(event.target.files?.[0] || null)} className="min-w-0 text-sm text-white/70" />
            <button type="submit" className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-[#062a27]">Add sticker</button>
          </form>
          <div className="mt-3 flex gap-2">
            <input value={newStickerCategory} onChange={(event) => setNewStickerCategory(event.target.value)} maxLength={60} placeholder="New shared category" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#142d32] px-3 py-2 text-sm text-white outline-none" />
            <button type="button" onClick={addStickerCategory} className="rounded-lg border border-white/15 px-3 py-2 text-sm">Add category</button>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {stickers.map((sticker) => (
              <li key={sticker._id} className="relative rounded-lg border border-white/10 p-2">
                <img src={`${API_URL}${sticker.imageUrl}`} alt={sticker.name} className="mx-auto h-16 w-16 object-contain" />
                <p className="truncate text-center text-xs text-white/70">{sticker.name}</p>
                <button type="button" onClick={() => deleteSticker(sticker)} className="mt-1 w-full text-xs text-rose-200">Remove</button>
              </li>
            ))}
          </ul>
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
