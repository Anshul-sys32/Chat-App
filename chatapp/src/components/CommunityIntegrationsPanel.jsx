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
  ['github', 'GitHub', 'Deliver repository activity to a channel.', true],
  ['webhook', 'Incoming webhook', 'Receive signed events from another service.', true],
  ['rss', 'RSS feed', 'Configure a feed destination; polling is unavailable.', true],
  ['google_calendar', 'Google Calendar', 'Unavailable until OAuth is configured.', false],
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

  const toggleLogs = (integrationId) => {
    if (logs[integrationId]) {
      setLogs((current) => ({ ...current, [integrationId]: null }));
      return;
    }
    loadLogs(integrationId);
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
                {integrations.length === 0 ? <p className="theme-muted py-6 text-center text-sm">No integrations configured.</p> : <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                  {integrations.map((integration) => (
                    <li key={integration.id} className="integration-card theme-border min-w-0 rounded-md border p-3">
                      <div className="flex min-w-0 flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{integration.name}<span className="theme-muted ml-2 text-[10px] uppercase">{integration.provider.replace('_', ' ')}</span></p><p className={`integration-status mt-1 flex items-center gap-1.5 text-xs ${!integration.enabled ? 'is-paused' : integration.operational ? 'is-operational' : 'is-attention'}`}><span aria-hidden="true" />#{integration.channelName} · {!integration.enabled ? 'Paused' : integration.operational ? 'Operational' : 'Needs setup'}</p>
                          {integration.provider === 'webhook' || integration.provider === 'github' ? <p className="integration-endpoint mt-2 break-all rounded px-2 py-1.5 font-mono text-[10px]">{API_URL}/api/integrations/{integration.id}/webhook</p> : null}
                          {integration.provider === 'rss' && <p className="theme-muted mt-1 text-[11px]">RSS polling is not active in this server build.</p>}
                          {integration.provider === 'google_calendar' && <p className="theme-muted mt-1 text-[11px]">OAuth authorization is not configured.</p>}
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-2">
                          <select value={integration.channelId} disabled={saving} onChange={(event) => perform(() => axios.patch(`${API_URL}/api/groups/${groupId}/integrations/${integration.id}`, { channelId: event.target.value }, authConfig()))} aria-label={`Destination channel for ${integration.name}`} className="theme-control min-w-0 flex-1 rounded px-2 py-1.5 text-xs">{channels.map((channel) => <option key={channel._id} value={channel._id}>#{channel.name}</option>)}</select>
                          <label className="flex shrink-0 items-center gap-2 text-xs"><input type="checkbox" checked={integration.enabled} disabled={saving} onChange={(event) => perform(() => axios.patch(`${API_URL}/api/groups/${groupId}/integrations/${integration.id}`, { enabled: event.target.checked }, authConfig()))} />Enabled</label>
                        </div>
                      </div>
                      <div className="theme-border mt-3 flex items-center justify-between gap-2 border-t pt-2">
                        <button type="button" aria-expanded={Boolean(logs[integration.id])} onClick={() => toggleLogs(integration.id)} className="workspace-menu-item rounded px-2 py-1 text-xs">{logs[integration.id] ? 'Hide history' : 'Execution history'}</button>
                        <button type="button" disabled={saving} onClick={() => perform(() => axios.delete(`${API_URL}/api/groups/${groupId}/integrations/${integration.id}`, authConfig()))} className="rounded px-2 py-1 text-xs theme-status-danger hover:bg-rose-500/10 disabled:opacity-40">Uninstall</button>
                      </div>
                      {logs[integration.id] && <ol aria-label={`Execution history for ${integration.name}`} className="integration-history theme-border mt-2 max-h-48 divide-y overflow-y-auto rounded border px-3">
                        {logs[integration.id].length ? logs[integration.id].map((log) => <li key={log.id} className="grid gap-x-3 gap-y-1 py-2 text-[11px] sm:grid-cols-[5.5rem_minmax(0,1fr)]"><div className="flex items-center gap-2"><span aria-hidden="true" className={`integration-log-dot ${log.status === 'failed' ? 'is-failed' : log.status === 'succeeded' ? 'is-succeeded' : ''}`} /><span className={log.status === 'failed' ? 'theme-status-danger' : log.status === 'succeeded' ? 'theme-status-success' : 'theme-muted'}>{log.status}</span></div><div className="min-w-0"><p className="break-words">{log.message || 'No details provided.'}</p><time className="theme-muted mt-1 block">{new Date(log.createdAt).toLocaleString()}</time></div></li>) : <li className="theme-muted py-3 text-xs">No executions recorded.</li>}
                      </ol>}
                    </li>
                  ))}
                </ul>}
              </section>
              <section aria-labelledby="new-integration-title" className="border-t border-white/10 pt-4">
                <h3 id="new-integration-title" className="text-sm font-semibold">Add an integration</h3>
                <form onSubmit={createIntegration} className="mt-3 space-y-3">
                  <fieldset className="grid gap-2 sm:grid-cols-2">
                    <legend className="sr-only">Integration provider</legend>
                    {providers.map(([key, label, description, available]) => <label key={key} className={`integration-provider-card theme-border min-w-0 cursor-pointer rounded-md border p-3 ${draft.provider === key ? 'is-selected' : ''}`}>
                      <input type="radio" name="integration-provider" value={key} checked={draft.provider === key} onChange={() => setDraft((current) => ({ ...current, provider: key, secret: '', feedUrl: '' }))} className="sr-only" />
                      <span className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">{label}</span><span className={`provider-availability ${available ? 'is-available' : 'is-unavailable'}`}>{available ? 'Available' : 'Unavailable'}</span></span>
                      <span className="theme-muted mt-1 block text-[11px] leading-4">{description}</span>
                    </label>)}
                  </fieldset>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={80} required placeholder="Integration name" aria-label="Integration name" className="theme-control min-w-0 rounded px-3 py-2 text-sm" />
                    <select value={draft.channelId} onChange={(event) => setDraft((current) => ({ ...current, channelId: event.target.value }))} required aria-label="Destination channel" className="theme-control min-w-0 rounded px-2 py-2 text-sm"><option value="">Destination channel</option>{channels.map((channel) => <option key={channel._id} value={channel._id}>#{channel.name}</option>)}</select>
                    {draft.provider === 'rss' && <input type="url" value={draft.feedUrl} onChange={(event) => setDraft((current) => ({ ...current, feedUrl: event.target.value }))} required placeholder="https://example.com/feed.xml" aria-label="RSS feed URL" className="theme-control min-w-0 rounded px-3 py-2 text-sm sm:col-span-2" />}
                    {['github', 'webhook'].includes(draft.provider) && <input value={draft.events} onChange={(event) => setDraft((current) => ({ ...current, events: event.target.value }))} maxLength={500} placeholder="Optional events, comma separated" aria-label="Subscribed event types" className="theme-control min-w-0 rounded px-3 py-2 text-sm sm:col-span-2" />}
                    {['github', 'webhook'].includes(draft.provider) && <input type="password" autoComplete="new-password" value={draft.secret} onChange={(event) => setDraft((current) => ({ ...current, secret: event.target.value }))} required maxLength={4096} placeholder="Webhook signing secret" aria-label="Webhook signing secret" className="theme-control min-w-0 rounded px-3 py-2 text-sm sm:col-span-2" />}
                  </div>
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
