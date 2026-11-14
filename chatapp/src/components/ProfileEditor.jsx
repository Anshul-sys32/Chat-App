import { useState } from "react";
import axios from "axios";
import { FaTimes } from "react-icons/fa";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
  withCredentials: true,
});

export default function ProfileEditor({ user, isAdmin = false, onClose, onSaved }) {
  const [username, setUsername] = useState(user.username || "");
  const [email, setEmail] = useState(user.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    const updates = { username, email };
    if (newPassword) updates.newPassword = newPassword;
    if (!isAdmin && currentPassword) updates.currentPassword = currentPassword;
    try {
      const endpoint = isAdmin
        ? `/api/admin/users/${user._id}/profile`
        : "/api/users/me/profile";
      const { data } = await axios.patch(`${API_URL}${endpoint}`, updates, authConfig());
      onSaved?.(data.user);
      onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not save profile changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="profile-editor-title" className="glass-panel w-full max-w-md rounded-2xl p-5 shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="profile-editor-title" className="text-xl font-semibold text-white">
              {isAdmin ? `Edit ${user.username}` : "Edit profile"}
            </h2>
            <p className="mt-1 text-sm text-white/60">Update account details{isAdmin ? " or set a replacement password" : "."}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Close profile editor">
            <FaTimes />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm text-white/75">
            Username
            <input value={username} onChange={(event) => setUsername(event.target.value)} required minLength={2} maxLength={100} autoComplete="username" className="glass-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-white outline-none" />
          </label>
          <label className="block text-sm text-white/75">
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={255} autoComplete="email" className="glass-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-white outline-none" />
          </label>
          {!isAdmin && (
            <label className="block text-sm text-white/75">
              Current password
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder="Required to change an existing password" className="glass-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-white outline-none placeholder:text-white/35" />
            </label>
          )}
          <label className="block text-sm text-white/75">
            {isAdmin ? "Replacement password (optional)" : "New password (optional)"}
            <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" className="glass-input mt-1.5 w-full rounded-lg px-3 py-2.5 text-white outline-none" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-rose-950/70 px-3 py-2 text-sm text-rose-200">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-[#062a27] transition hover:bg-teal-300 disabled:opacity-60">
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
