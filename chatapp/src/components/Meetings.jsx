import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { FaCalendarAlt, FaTimes } from "react-icons/fa";

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || "";
const authConfig = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` } });

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
};

export default function Meetings() {
  const [meetings, setMeetings] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [invitees, setInvitees] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const loadMeetings = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/meetings`, authConfig());
      setMeetings(Array.isArray(data) ? data : []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not load meetings.");
    }
  }, []);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  const createMeeting = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const inviteeList = [...new Set(invitees.split(/[\n,;]/).map((value) => value.trim()).filter(Boolean))];
      const { data } = await axios.post(`${API_URL}/api/meetings`, {
        title,
        description,
        scheduledAt: new Date(scheduledAt).toISOString(),
        invitees: inviteeList,
      }, authConfig());
      setMeetings((current) => [...current, { ...data, isOrganizer: 1, organizerId: JSON.parse(localStorage.getItem("user") || "{}")._id }].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)));
      setTitle("");
      setDescription("");
      setScheduledAt("");
      setInvitees("");
      setSuccess(`Meeting scheduled and ${data.invitees} invitation${data.invitees === 1 ? "" : "s"} sent.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not schedule this meeting.");
    } finally {
      setSaving(false);
    }
  };

  const cancelMeeting = async (meeting) => {
    if (!window.confirm(`Cancel ${meeting.title}?`)) return;
    try {
      await axios.delete(`${API_URL}/api/meetings/${meeting._id}`, authConfig());
      setMeetings((current) => current.map((item) => String(item._id) === String(meeting._id) ? { ...item, status: "cancelled" } : item));
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Could not cancel this meeting.");
    }
  };

  return (
    <section className="space-y-5 text-white" aria-labelledby="meetings-title">
      <header><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300">Calendar</p><h2 id="meetings-title" className="mt-1 text-xl font-semibold">Scheduled meetings</h2><p className="mt-1 text-sm text-white/55">Plan a time, invite people, and get a reminder 15 minutes before it starts.</p></header>
      {error && <p role="alert" className="rounded-lg border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      {success && <p role="status" className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{success}</p>}
      <form onSubmit={createMeeting} className="space-y-3 rounded-xl border border-white/10 bg-white/[0.035] p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><FaCalendarAlt className="text-teal-300" /> Schedule a meeting</h3>
        <label className="block text-sm"><span className="mb-1 block text-white/65">Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-teal-300/60" /></label>
        <label className="block text-sm"><span className="mb-1 block text-white/65">Date and time</span><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-teal-300/60" /></label>
        <label className="block text-sm"><span className="mb-1 block text-white/65">Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={2} className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-teal-300/60" /></label>
        <label className="block text-sm"><span className="mb-1 block text-white/65">Invitees</span><textarea value={invitees} onChange={(event) => setInvitees(event.target.value)} rows={2} placeholder="Enter usernames or emails, separated by commas" className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none placeholder:text-white/35 focus:border-teal-300/60" /><span className="mt-1 block text-xs text-white/45">Invitations arrive in Alerts.</span></label>
        <button type="submit" disabled={saving} className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{saving ? "Scheduling…" : "Schedule meeting"}</button>
      </form>
      <div className="space-y-2"><h3 className="text-sm font-semibold">Your meetings</h3>{meetings.length ? meetings.map((meeting) => <article key={meeting._id} className="flex items-start gap-3 rounded-xl border border-white/10 p-3"><FaCalendarAlt className="mt-1 shrink-0 text-teal-300" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{meeting.title}</p><p className="mt-1 text-xs text-white/60">{formatDate(meeting.scheduledAt)}</p>{meeting.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-white/70">{meeting.description}</p>}<p className="mt-2 text-xs text-white/45">{meeting.isOrganizer ? "Organizer" : `Invitation ${meeting.invitationStatus || "pending"}`} · {meeting.status}</p></div>{meeting.isOrganizer && meeting.status === "scheduled" && <button type="button" onClick={() => cancelMeeting(meeting)} className="rounded p-2 text-white/50 hover:bg-rose-500/10 hover:text-rose-200" aria-label={`Cancel ${meeting.title}`} title="Cancel meeting"><FaTimes size={12} /></button>}</article>) : <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-sm text-white/45">No meetings scheduled.</p>}</div>
    </section>
  );
}
