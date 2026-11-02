import { createElement, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { FaBell, FaChevronRight, FaCog, FaMoon, FaPalette, FaSun, FaUser, FaVideo } from "react-icons/fa";
import MediaDeviceSettings from "./MediaDeviceSettings";
import Avatar from "./Avatar";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` } });

const sections = [
  { id: "account", label: "Account", icon: FaUser },
  { id: "appearance", label: "Appearance", icon: FaPalette },
  { id: "notifications", label: "Notifications", icon: FaBell },
  { id: "devices", label: "Audio & video", icon: FaVideo },
];

export default function SettingsPanel({ user, theme, onToggleTheme, onOpenProfile, onCloseSettings, selectedChat, conversationMuted, conversationMuteLoading, conversationMuteSaving, conversationMuteError, onToggleConversationMute }) {
  const [activeSection, setActiveSection] = useState("account");
  const [preferences, setPreferences] = useState({ browserNotifications: false, notificationSounds: false });
  const [error, setError] = useState("");
  const [chatSettingsSurface, setChatSettingsSurface] = useState(null);
  const visibleSections = selectedChat
    ? [...sections, { id: "conversation", label: "Current conversation", icon: FaBell }]
    : sections;

  useEffect(() => {
    setChatSettingsSurface(document.getElementById("chat-area-settings"));
  }, []);

  useEffect(() => {
    if (activeSection !== "notifications") return undefined;
    let active = true;
    axios.get(`${API_URL}/api/notifications/preferences`, authConfig()).then(({ data }) => {
      if (active) setPreferences(data);
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || "Could not load notification preferences.");
    });
    return () => { active = false; };
  }, [activeSection]);

  useEffect(() => {
    if (!selectedChat && activeSection === "conversation") setActiveSection("account");
  }, [activeSection, selectedChat]);

  const updatePreference = async (key, value) => {
    setError("");
    const previous = preferences;
    setPreferences((current) => ({ ...current, [key]: value }));
    try {
      const { data } = await axios.patch(`${API_URL}/api/notifications/preferences`, { [key]: value }, authConfig());
      setPreferences(data);
    } catch (requestError) {
      setPreferences(previous);
      setError(requestError.response?.data?.message || "Could not save this preference.");
    }
  };

  const settingsContent = (
    <div className="pointer-events-auto flex min-h-full min-w-0 items-center justify-center bg-black/60 p-4 text-white backdrop-blur-sm sm:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="chat-settings-window-title" className="glass-panel flex max-h-[calc(100dvh-2rem)] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-2xl p-0 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-300">Chat workspace</p><h2 id="chat-settings-window-title" className="text-lg font-semibold">Settings</h2></div>
          <button type="button" onClick={onCloseSettings} className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close settings window" title="Close settings"><span aria-hidden="true">×</span></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="min-w-0">
          {activeSection === "account" && <div><h3 className="text-base font-semibold">Account</h3><div className="mt-4 flex items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-3"><Avatar src={user?.profilePicture || user?.googlePicture} name={user?.username} className="h-12 w-12" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user?.username}</p><p className="truncate text-xs text-white/50">{user?.email}</p></div><button type="button" onClick={onOpenProfile} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75 hover:bg-white/10">Edit profile</button></div><div className="mt-5 space-y-3"><SettingRow label="Signed-in account" description="Your profile details and password are managed here." /><SettingRow label="Account status" description="Active" /></div></div>}
          {activeSection === "appearance" && <div><h3 className="text-base font-semibold">Appearance</h3><p className="mt-1 text-xs text-white/55">Choose how Chat App looks on this device.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => theme !== "light" && onToggleTheme()} className={`rounded-xl border p-4 text-left ${theme === "light" ? "border-teal-300 bg-teal-300/10" : "border-white/10 hover:bg-white/10"}`}><FaSun className="mb-3 text-amber-300" /><p className="text-sm font-semibold">Light mode</p><p className="mt-1 text-xs text-white/50">Bright and clear</p></button><button type="button" onClick={() => theme !== "dark" && onToggleTheme()} className={`rounded-xl border p-4 text-left ${theme === "dark" ? "border-teal-300 bg-teal-300/10" : "border-white/10 hover:bg-white/10"}`}><FaMoon className="mb-3 text-indigo-200" /><p className="text-sm font-semibold">Dark mode</p><p className="mt-1 text-xs text-white/50">Low-light friendly</p></button></div></div>}
          {activeSection === "notifications" && <div><h3 className="text-base font-semibold">Notifications</h3><p className="mt-1 text-xs text-white/55">Control alerts for messages and activity.</p>{error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}<div className="mt-4 divide-y divide-white/10 rounded-xl border border-white/10"> <SettingToggle label="Browser notifications" description="Show alerts when Chat App is in the background." checked={preferences.browserNotifications} onChange={(value) => updatePreference("browserNotifications", value)} /><SettingToggle label="Notification sounds" description="Play a short sound for supported alerts." checked={preferences.notificationSounds} onChange={(value) => updatePreference("notificationSounds", value)} /></div></div>}
          {activeSection === "devices" && <div><MediaDeviceSettings userId={user?._id} /></div>}
          {activeSection === "conversation" && selectedChat && <div><h3 className="text-base font-semibold">Current conversation</h3><p className="mt-1 text-sm text-white/60">Notification preferences for {selectedChat.name || selectedChat.username}.</p>{conversationMuteError && <p role="alert" className="mt-3 text-sm text-rose-300">{conversationMuteError}</p>}<div className="mt-4 rounded-xl border border-white/10"><SettingToggle label="Mute notifications" description="Messages will still arrive, but this conversation will not create message alerts." checked={Boolean(conversationMuted)} disabled={conversationMuteLoading || conversationMuteSaving} onChange={() => onToggleConversationMute?.()} /></div></div>}
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <>
      <section className="text-white" aria-labelledby="settings-title">
        <div className="mb-5"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300">Preferences</p><h2 id="settings-title" className="mt-1 text-xl font-semibold">Settings</h2><p className="mt-1 text-xs text-white/55">Choose a settings category to view its options in the chat area.</p></div>
        <nav className="space-y-1" aria-label="Settings sections">{visibleSections.map(({ id, label, icon }) => <button key={id} type="button" onClick={() => setActiveSection(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${activeSection === id ? "bg-teal-300/15 text-teal-200" : "text-white/65 hover:bg-white/10 hover:text-white"}`}>{createElement(icon, { size: 13 })}<span className="flex-1">{label}</span>{activeSection === id && <FaChevronRight size={10} />}</button>)}</nav>
      </section>
      {chatSettingsSurface ? createPortal(settingsContent, chatSettingsSurface) : null}
    </>
  );
}

function SettingRow({ label, description }) {
  return <div className="flex items-start gap-3 rounded-xl border border-white/10 p-3"><FaCog className="mt-0.5 text-white/40" size={13} /><div><p className="text-sm">{label}</p><p className="mt-1 text-xs text-white/50">{description}</p></div></div>;
}

function SettingToggle({ label, description, checked, onChange, disabled = false }) {
  return <label className={`flex items-center gap-3 p-3 ${disabled ? "cursor-wait opacity-60" : "cursor-pointer"}`}><FaBell className="text-white/45" size={13} /><span className="min-w-0 flex-1"><span className="block text-sm">{label}</span><span className="mt-1 block text-xs text-white/50">{description}</span></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-teal-300" /></label>;
}
