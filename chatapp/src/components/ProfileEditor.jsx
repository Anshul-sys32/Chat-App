import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { FaCamera, FaTimes } from "react-icons/fa";
import Avatar from "./Avatar";

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
  const [avatarError, setAvatarError] = useState("");
  const [avatarSource, setAvatarSource] = useState(user.profilePicture || user.googlePicture || null);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInput = useRef(null);

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  const uploadAvatar = async (file) => {
    if (!file) return;
    setAvatarError("");
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Profile images must be 5 MB or smaller.");
      return;
    }
    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);
    setUploadingAvatar(true);
    const formData = new FormData();
    formData.append("avatar", file);
    const endpoint = isAdmin
      ? `/api/admin/users/${user._id}/profile-picture`
      : "/api/users/me/profile-picture";
    try {
      const { data } = await axios.post(`${API_URL}${endpoint}`, formData, authConfig());
      setAvatarSource(data.user.profilePicture || data.user.googlePicture || null);
      setAvatarPreview("");
      onSaved?.({ ...user, ...data.user });
    } catch (requestError) {
      setAvatarPreview("");
      setAvatarError(requestError.response?.data?.message || "Could not update the profile image.");
    } finally {
      setUploadingAvatar(false);
      if (avatarInput.current) avatarInput.current.value = "";
    }
  };

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
          <div className="mb-5 flex items-center gap-4">
            <Avatar
              src={avatarPreview || avatarSource}
              name={username || user.username}
              className="h-16 w-16 text-xl"
            />
            <div>
              <input
                ref={avatarInput}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
                className="sr-only"
                aria-label="Choose profile image"
                onChange={(event) => uploadAvatar(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => avatarInput.current?.click()}
                disabled={uploadingAvatar}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-60"
              >
                <FaCamera size={12} /> {uploadingAvatar ? "Uploading…" : "Change photo"}
              </button>
              <p className="mt-1 text-xs text-white/50">JPEG, PNG, GIF, WebP, or AVIF · up to 5 MB</p>
              {avatarError && <p role="alert" className="mt-1 text-xs text-rose-300">{avatarError}</p>}
            </div>
          </div>
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
