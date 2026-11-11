import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { FaTimes } from 'react-icons/fa';
import useDialogFocus from '../useDialogFocus';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  withCredentials: true,
});
const providers = [
  ['github', 'GitHub'],
  ['webhook', 'Incoming webhook'],
  ['rss', 'RSS feed'],
  ['google_calendar', 'Google Calendar'],
];

export default function CommunityIntegrationsPanel({ groupId, groupName, onClose }) {
  const [integrations, setIntegrations] = useState([]);
  const [channels, setChannels] = useState([]);
  const [logs, setLogs] = useState({});
  const [draft, setDraft] = useState({ provider: 'github', name: '', channelId: '', secret: '', feedUrl: '', events: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(true, onClose);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [integrationResponse, channelResponse] = await Promise.all([
        axios.get(`${API_URL}/api/groups/${groupId}/integrations`, authConfig()),
        axios.get(`${API_URL}/api/groups/${groupId}/channels`, authConfig()),
      ]);
      setIntegrations(integrationResponse.data.integrations || []);
      setChannels((channelResponse.data.channels || []).filter((channel) => channel.channelType === 'text'));
    } catch (requestError) {
      setError(requestError.response?.status === 403
        ? 'You do not have permission to manage integrations in this community.'
        : requestError.response?.data?.message || 'Could not load integrations.');
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
      setError(requestError.response?.data?.message || 'Could not update this integration.');
    } finally {
      setSaving(false);
    }
  };

  const createIntegration = (event) => {
    event.preventDefault();
    const config = {
      ...(draft.provider === 'rss' ? { feedUrl: draft.feedUrl.trim() } : {}),
      ...(draft.events.trim() ? { events: [...new Set(draft.events.split(',').map((item) => item.trim()).filter(Boolean))] } : {}),
    };
    return perform(async () => {
      await axios.post(`${API_URL}/api/groups/${groupId}/integrations`, {
        provider: draft.provider,
        name: draft.name.trim(),
        channelId: draft.channelId,
        config,
        ...(draft.secret ? { secret: draft.secret } : {}),
      }, authConfig());
      setDraft((current) => ({ ...current, name: '', secret: '', feedUrl: '', events: '' }));
    });
  };

  const loadLogs = async (integrationId) => {
    try {
      const { data } = await axios.get(`${API_URL}/api/groups/${groupId}/integrations/${integrationId}/logs`, authConfig());
      setLogs((current) => ({ ...current, [integrationId]: data.logs || [] }));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load execution history.');
    }
  };

  const currentProvider = providers.find(([key]) => key === draft.provider);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="community-integrations-title" className="glass-panel flex max-h-[min(94dvh,60rem)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border shadow-2xl outline-none">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0"><h2 id="community-integrations-title" className="text-sm font-semibold">Integrations · {groupName}</h2><p className="theme-muted mt-0.5 text-xs">Community connections, channel delivery, and execution history</p></div>
          <button type="button" onClick={onClose} aria-label="Close integrations" title="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          {error && <p role="alert" className="rounded border border-rose-300/20 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">{error}</p>}
          {loading ? <p role="status" className="theme-muted py-8 text-center text-sm">Loading integrations…</p> : (
            <>
              <section aria-labelledby="integration-list-title">
                <div className="flex items-center justify-between gap-3"><h3 id="integration-list-title" className="text-sm font-semibold">Connected services</h3><span className="theme-muted text-xs">{integrations.length}</span></div>
                {integrations.length === 0 ? <p className="theme-muted py-6 text-center text-sm">No integrations configured.</p> : <ul className="mt-2 divide-y divide-white/10">
                  {integrations.map((integration) => (
                    <li key={integration.id} className="py-3">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{integration.name}<span className="theme-muted ml-2 text-[10px] uppercase">{integration.provider.replace('_', ' ')}</span></p><p className="theme-muted mt-1 flex items-center gap-1.5 text-xs"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${integration.operational ? 'bg-emerald-400' : 'bg-amber-400'}`} />#{integration.channelName} · {integration.operational ? 'Operational' : 'Needs setup'}</p>
                          {integration.provider === 'webhook' || integration.provider === 'github' ? <p className="mt-1 break-all font-mono text-[10px] text-accent-text">{API_URL}/api/integrations/{integration.id}/webhook</p> : null}
                          {integration.provider === 'rss' && <p className="theme-muted mt-1 text-[11px]">RSS polling is not active in this server build.</p>}
                          {integration.provider === 'google_calendar' && <p className="theme-muted mt-1 text-[11px]">OAuth authorization is not configured.</p>}
                        </div>
                        <select value={integration.channelId} disabled={saving} onChange={(event) => perform(() => axios.patch(`${API_URL}/api/groups/${groupId}/integrations/${integration.id}`, { channelId: event.target.value }, authConfig()))} aria-label={`Destination channel for ${integration.name}`} className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs">{channels.map((channel) => <option key={channel._id} value={channel._id}>#{channel.name}</option>)}</select>
                        <label className="flex shrink-0 items-center gap-2 text-xs"><input type="checkbox" checked={integration.enabled} disabled={saving} onChange={(event) => perform(() => axios.patch(`${API_URL}/api/groups/${groupId}/integrations/${integration.id}`, { enabled: event.target.checked }, authConfig()))} />Enabled</label>
                        <button type="button" onClick={() => loadLogs(integration.id)} className="rounded border border-white/15 px-2.5 py-1.5 text-xs hover:bg-white/10">History</button>
                        <button type="button" disabled={saving} onClick={() => perform(() => axios.delete(`${API_URL}/api/groups/${groupId}/integrations/${integration.id}`, authConfig()))} className="rounded px-2 py-1.5 text-xs text-rose-200 hover:bg-rose-950/40 disabled:opacity-40">Uninstall</button>
                      </div>
                      {logs[integration.id] && <ol className="mt-3 max-h-40 divide-y divide-white/5 overflow-y-auto rounded border border-white/10 px-3">
                        {logs[integration.id].length ? logs[integration.id].map((log) => <li key={log.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-[11px]"><span><span className={log.status === 'failed' ? 'text-rose-200' : log.status === 'succeeded' ? 'text-emerald-200' : 'theme-muted'}>{log.status}</span><span className="theme-muted ml-2">{log.message}</span></span><time className="theme-muted">{new Date(log.createdAt).toLocaleString()}</time></li>) : <li className="theme-muted py-3 text-xs">No executions recorded.</li>}
                      </ol>}
                    </li>
                  ))}
                </ul>}
              </section>
              <section aria-labelledby="new-integration-title" className="border-t border-white/10 pt-4">
                <h3 id="new-integration-title" className="text-sm font-semibold">Add an integration</h3>
                <form onSubmit={createIntegration} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <select value={draft.provider} onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value, secret: '', feedUrl: '' }))} aria-label="Integration provider" className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-sm">
                    {providers.map(([key, label]) => <option key={key} value={key}>{label}{key === 'google_calendar' ? ' · unavailable' : ''}</option>)}
                  </select>
                  <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={80} required placeholder="Integration name" aria-label="Integration name" className="glass-input min-w-0 rounded border px-3 py-2 text-sm" />
                  <select value={draft.channelId} onChange={(event) => setDraft((current) => ({ ...current, channelId: event.target.value }))} required aria-label="Destination channel" className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-sm"><option value="">Destination channel</option>{channels.map((channel) => <option key={channel._id} value={channel._id}>#{channel.name}</option>)}</select>
                  {draft.provider === 'rss' ? <input type="url" value={draft.feedUrl} onChange={(event) => setDraft((current) => ({ ...current, feedUrl: event.target.value }))} required placeholder="https://example.com/feed.xml" aria-label="RSS feed URL" className="glass-input min-w-0 rounded border px-3 py-2 text-sm" /> : <span className="hidden lg:block" />}
                  {['github', 'webhook'].includes(draft.provider) && <input value={draft.events} onChange={(event) => setDraft((current) => ({ ...current, events: event.target.value }))} maxLength={500} placeholder="Optional events, comma separated" aria-label="Subscribed event types" className="glass-input min-w-0 rounded border px-3 py-2 text-sm sm:col-span-2" />}
                  {['github', 'webhook'].includes(draft.provider) && <input type="password" autoComplete="new-password" value={draft.secret} onChange={(event) => setDraft((current) => ({ ...current, secret: event.target.value }))} required maxLength={4096} placeholder="Webhook signing secret" aria-label="Webhook signing secret" className="glass-input min-w-0 rounded border px-3 py-2 text-sm sm:col-span-2" />}
                  <button type="submit" disabled={saving || draft.provider === 'google_calendar' || channels.length === 0} className="w-fit rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast disabled:opacity-40">Add {currentProvider?.[1]}</button>
                  {draft.provider === 'rss' && <p className="theme-muted self-center text-xs">Feed configured but not operational until server polling is enabled.</p>}
                  {draft.provider === 'google_calendar' && <p className="theme-muted self-center text-xs">Google OAuth is required before this provider can be installed.</p>}
                </form>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
