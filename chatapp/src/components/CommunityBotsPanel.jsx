import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { FaRobot, FaTimes } from 'react-icons/fa';
import useDialogFocus from '../useDialogFocus';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  withCredentials: true,
});

export default function CommunityBotsPanel({ groupId, groupName, onClose }) {
  const [bots, setBots] = useState([]);
  const [channels, setChannels] = useState([]);
  const [draft, setDraft] = useState({ name: '', command: '', description: '', response: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(true, onClose);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [botResponse, channelResponse] = await Promise.all([
        axios.get(`${API_URL}/api/groups/${groupId}/bots`, authConfig()),
        axios.get(`${API_URL}/api/groups/${groupId}/channels`, authConfig()),
      ]);
      setBots(botResponse.data.bots || []);
      setChannels((channelResponse.data.channels || []).filter((channel) => channel.channelType === 'text'));
    } catch (requestError) {
      setError(requestError.response?.status === 403
        ? 'Only community managers can change bot installations.'
        : requestError.response?.data?.message || 'Could not load community bots.');
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { loadData(); }, [loadData]);

  const perform = async (operation) => {
    setSaving(true);
    setError('');
    try {
      await operation();
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.status === 403
        ? 'Only community managers can change bot installations.'
        : requestError.response?.data?.message || 'Could not update this bot.');
    } finally {
      setSaving(false);
    }
  };

  const createBot = (event) => {
    event.preventDefault();
    const command = draft.command.trim().toLowerCase();
    return perform(async () => {
      await axios.post(`${API_URL}/api/groups/${groupId}/bots`, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        commands: [{ key: command, description: draft.description.trim(), content: draft.response.trim() }],
      }, authConfig());
      setDraft({ name: '', command: '', description: '', response: '' });
    });
  };

  const updateChannelScope = (bot, channelId, checked) => {
    const current = new Set((bot.allowedChannelIds || []).map(Number));
    if (checked) current.add(Number(channelId));
    else current.delete(Number(channelId));
    return perform(() => axios.patch(`${API_URL}/api/groups/${groupId}/bots/${bot.id}`, {
      allowedChannelIds: [...current],
    }, authConfig()));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="community-bots-title" className="glass-panel flex max-h-[min(92dvh,52rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border shadow-2xl outline-none">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0"><h2 id="community-bots-title" className="text-sm font-semibold">Bots · {groupName}</h2><p className="theme-muted mt-0.5 text-xs">Community installations and channel access</p></div>
          <button type="button" onClick={onClose} aria-label="Close bot management" title="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          {error && <p role="alert" className="rounded border border-rose-300/20 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">{error}</p>}
          {loading ? <p role="status" className="theme-muted py-8 text-center text-sm">Loading bots…</p> : (
            <>
              <section aria-labelledby="installed-bots-title">
                <div className="flex items-center justify-between gap-3"><h3 id="installed-bots-title" className="text-sm font-semibold">Installed bots</h3><span className="theme-muted text-xs">{bots.length}</span></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {['help', 'welcome'].filter((key) => !bots.some((bot) => bot.botKey === key)).map((key) => (
                    <button key={key} type="button" disabled={saving} onClick={() => perform(() => axios.put(`${API_URL}/api/groups/${groupId}/bots/built-in/${key}`, {}, authConfig()))} className="bot-provider-card theme-border flex min-w-0 items-center gap-3 rounded-md border p-3 text-left disabled:opacity-40">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-accent-soft text-accent-text"><FaRobot /></span>
                      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{key === 'help' ? 'Help bot' : 'Welcome bot'}</span><span className="theme-muted mt-0.5 block text-[11px]">{key === 'help' ? 'Answer common community questions' : 'Greet members when they join'}</span></span>
                      <span className="shrink-0 text-xs font-medium text-accent-text">Install</span>
                    </button>
                  ))}
                </div>
                {bots.length === 0 ? <p className="theme-muted py-5 text-center text-sm">No bots installed.</p> : <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {bots.map((bot) => (
                    <li key={bot.id} className="bot-installation-card theme-border min-w-0 rounded-md border p-3">
                      <div className="flex items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-accent-soft text-accent-text"><FaRobot /></span>
                        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{bot.name}<span className="theme-muted ml-2 text-[10px] uppercase">{bot.botType}</span></p><p className="theme-muted mt-1 text-xs">{bot.description}</p></div>
                        <label className="flex shrink-0 items-center gap-2 text-xs"><input type="checkbox" checked={bot.enabled} disabled={saving} onChange={(event) => perform(() => axios.patch(`${API_URL}/api/groups/${groupId}/bots/${bot.id}`, { enabled: event.target.checked }, authConfig()))} />Enabled</label>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className={`bot-status ${bot.enabled ? 'is-active' : 'is-paused'}`}><span aria-hidden="true" />{bot.enabled ? 'Active' : 'Paused'}</span>
                        <button type="button" disabled={saving} onClick={() => perform(() => axios.delete(`${API_URL}/api/groups/${groupId}/bots/${bot.id}`, authConfig()))} className="rounded px-2 py-1 text-xs theme-status-danger hover:bg-rose-500/10 disabled:opacity-40">Uninstall</button>
                      </div>
                      {bot.commands?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{bot.commands.map((command) => <code key={command.key} className="bot-command rounded px-2 py-1 text-[11px]">/{command.key}</code>)}</div>}
                      {channels.length > 0 && bot.enabled && <fieldset className="theme-border mt-3 border-t pt-2"><legend className="theme-muted mb-1 text-[11px]">Allowed channels. Leave all unchecked for every text channel.</legend><div className="flex flex-wrap gap-x-4 gap-y-2">
                        {channels.map((channel) => <label key={channel._id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={(bot.allowedChannelIds || []).map(Number).includes(Number(channel._id))} disabled={saving} onChange={(event) => updateChannelScope(bot, channel._id, event.target.checked)} />#{channel.name}</label>)}
                      </div></fieldset>}
                    </li>
                  ))}
                </ul>}
              </section>
              <section aria-labelledby="custom-bot-title" className="theme-border border-t pt-4">
                <h3 id="custom-bot-title" className="text-sm font-semibold">Create a custom bot</h3>
                <form onSubmit={createBot} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={80} required placeholder="Bot name" aria-label="Bot name" className="theme-control min-w-0 rounded px-3 py-2 text-sm" />
                  <input value={draft.command} onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" required placeholder="Command name" aria-label="Command name" className="theme-control min-w-0 rounded px-3 py-2 text-sm" />
                  <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={120} placeholder="Command description" aria-label="Command description" className="theme-control min-w-0 rounded px-3 py-2 text-sm sm:col-span-2" />
                  <textarea value={draft.response} onChange={(event) => setDraft((current) => ({ ...current, response: event.target.value }))} maxLength={2000} required rows={3} placeholder="Response. Use {{args}} to insert command text." aria-label="Bot response" className="theme-control min-w-0 resize-y rounded px-3 py-2 text-sm sm:col-span-2" />
                  <button type="submit" disabled={saving} className="w-fit rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast disabled:opacity-40">Create bot</button>
                </form>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
