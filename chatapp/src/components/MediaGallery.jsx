import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FaDownload, FaExternalLinkAlt, FaFile, FaImage, FaLink, FaStar, FaTimes } from 'react-icons/fa';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';
const mediaOptions = [
  ['all', 'All media'],
  ['image', 'Images'],
  ['video', 'Videos'],
  ['audio', 'Audio'],
  ['document', 'Documents'],
  ['file', 'Files'],
  ['link', 'Links'],
];

const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  withCredentials: true,
});

const displayDate = (timestamp) => new Date(timestamp).toLocaleString(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatSize = (size) => {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function MediaGallery({ open, onClose, conversation = null, onJumpToMessage }) {
  const conversationId = conversation?._id;
  const conversationType = conversation?.type;
  const conversationChannelId = conversation?.channelId;
  const [filters, setFilters] = useState({ search: '', mediaType: 'all', senderId: '', from: '', to: '', sort: 'newest' });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [items, setItems] = useState([]);
  const [savedKeys, setSavedKeys] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    axios.get(`${API_URL}/api/saved-messages`, authConfig())
      .then(({ data }) => {
        if (active) setSavedKeys(new Set((data.messages || []).map((message) => `${message.messageType}:${message._id}`)));
      })
      .catch(() => {
        if (active) setSavedKeys(new Set());
      });
    return () => { active = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    const params = {
      ...appliedFilters,
      page,
      pageSize: 24,
      ...(conversationId ? {
        conversationType: conversationType === 'group' ? 'group' : 'direct',
        conversationId,
        ...(conversationType === 'group' && conversationChannelId ? { channelId: conversationChannelId } : {}),
      } : {}),
    };
    axios.get(`${API_URL}/api/media-gallery`, { ...authConfig(), params })
      .then(({ data }) => {
        if (!active) return;
        setItems(data.items || []);
        setHasMore(Boolean(data.hasMore));
      })
      .catch((requestError) => {
        if (!active) return;
        const status = requestError.response?.status;
        setError(status === 401 || status === 403
          ? 'You no longer have permission to view this conversation’s media.'
          : requestError.response?.data?.message || 'Could not load media.');
        setItems([]);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, conversationId, conversationType, conversationChannelId, appliedFilters, page]);

  if (!open) return null;

  const saveKey = (item) => `${item.messageType}:${item.messageId}`;

  const toggleSaved = async (item) => {
    const key = saveKey(item);
    const isSaved = savedKeys.has(key);
    const endpoint = `${API_URL}/api/saved-messages/${item.messageType}/${item.messageId}`;
    try {
      if (isSaved) await axios.delete(endpoint, authConfig());
      else await axios.put(endpoint, {}, authConfig());
      setSavedKeys((current) => {
        const next = new Set(current);
        if (isSaved) next.delete(key);
        else next.add(key);
        return next;
      });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update saved media.');
    }
  };

  const downloadItem = async (item) => {
    if (item.mediaType === 'link') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      const { data } = await axios.get(`${API_URL}${item.url}`, {
        ...authConfig(),
        params: { download: '1' },
        responseType: 'blob',
      });
      const downloadUrl = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = item.name || 'download';
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not download this file.');
    }
  };

  const jumpToMessage = (item) => {
    onJumpToMessage?.({
      ...item,
      _id: item.messageId,
      ...(item.messageType === 'group'
        ? { groupId: item.groupId, groupName: item.groupName, groupType: item.groupType }
        : { conversationId: item.conversationId, conversationName: item.conversationName }),
    });
    onClose();
  };

  const mediaUrl = (item) => item.url?.startsWith('/') ? `${API_URL}${item.url}` : '';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="media-gallery-title" className="glass-panel flex max-h-[min(94dvh,60rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="media-gallery-title" className="text-sm font-semibold">{conversation ? `Media · ${conversation.name || conversation.username || 'Conversation'}` : 'Media gallery'}</h2>
            <p className="theme-muted mt-0.5 text-xs">{conversation?.channelName ? `# ${conversation.channelName}` : 'Photos, files, audio, video, and links'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close media gallery" title="Close gallery" className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
        </header>

        <form onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedFilters({ ...filters }); }} className="grid shrink-0 gap-2 border-b border-white/10 p-3 sm:grid-cols-2 lg:grid-cols-6 sm:px-5">
          <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} maxLength={100} aria-label="Search media" placeholder="Search files or messages" className="glass-input min-w-0 rounded border px-3 py-2 text-sm sm:col-span-2 lg:col-span-2" />
          <select value={filters.mediaType} onChange={(event) => { const mediaType = event.target.value; setFilters((current) => ({ ...current, mediaType })); }} aria-label="Media type" className="min-w-0 rounded border border-white/10 bg-slate-900 px-2 py-2 text-sm">
            {mediaOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="number" min="1" value={filters.senderId} onChange={(event) => setFilters((current) => ({ ...current, senderId: event.target.value }))} aria-label="Filter by sender ID" placeholder="Sender ID" className="glass-input min-w-0 rounded border px-3 py-2 text-sm" />
          <input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} aria-label="From date" className="glass-input min-w-0 rounded border px-2 py-2 text-sm" />
          <div className="flex min-w-0 gap-2">
            <input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} aria-label="To date" className="glass-input min-w-0 flex-1 rounded border px-2 py-2 text-sm" />
            <button type="submit" className="shrink-0 rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast">Apply</button>
          </div>
          <label className="flex items-center gap-2 text-xs sm:col-span-2 lg:col-span-6">
            <span className="theme-muted">Sort</span>
            <select value={filters.sort} onChange={(event) => { const sort = event.target.value; setFilters((current) => ({ ...current, sort })); setPage(1); setAppliedFilters((current) => ({ ...current, sort })); }} aria-label="Sort media" className="rounded border border-white/10 bg-slate-900 px-2 py-1.5">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </form>

        {error && <p role="alert" className="mx-4 mt-3 rounded border border-rose-300/20 bg-rose-950/30 px-3 py-2 text-sm text-rose-200 sm:mx-5">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {loading ? <p role="status" className="theme-muted py-12 text-center text-sm">Loading media…</p>
            : items.length === 0 ? <p className="theme-muted py-12 text-center text-sm">{error ? 'Media is unavailable.' : 'No media matches these filters.'}</p>
              : <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item, index) => {
                  const key = `${item.messageType}:${item.messageId}:${item.url}:${index}`;
                  const saved = savedKeys.has(saveKey(item));
                  return (
                    <li key={key} className="glass-panel min-w-0 overflow-hidden rounded-md border border-white/10">
                      <div className="grid aspect-[16/10] place-items-center overflow-hidden bg-black/20">
                        {item.mediaType === 'image' && <img src={mediaUrl(item)} alt={item.name || 'Shared image'} loading="lazy" crossOrigin="use-credentials" className="h-full w-full object-contain" />}
                        {item.mediaType === 'video' && <video src={mediaUrl(item)} controls preload="metadata" crossOrigin="use-credentials" className="h-full w-full object-contain" aria-label={item.name || 'Shared video'} />}
                        {item.mediaType === 'audio' && <div className="w-full px-4"><FaImage className="mx-auto mb-4 text-2xl opacity-50" /><audio src={mediaUrl(item)} controls preload="none" crossOrigin="use-credentials" className="w-full" aria-label={item.name || 'Shared audio'} /></div>}
                        {item.mediaType === 'link' && <a href={item.url} target="_blank" rel="noreferrer" className="flex max-h-full w-full flex-col items-center justify-center gap-3 overflow-hidden p-4 text-center text-accent-text"><FaLink className="shrink-0 text-2xl" /><span className="line-clamp-3 break-all text-sm">{item.url}</span></a>}
                        {!['image', 'video', 'audio', 'link'].includes(item.mediaType) && <div className="flex flex-col items-center gap-2 px-4 text-center"><FaFile className="text-3xl opacity-55" /><span className="line-clamp-2 break-all text-xs">{item.name || 'Shared file'}</span></div>}
                      </div>
                      <div className="min-w-0 p-3">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium" title={item.name}>{item.name || item.url}</p>
                            <p className="theme-muted mt-1 truncate text-[11px]">{item.senderName} · {displayDate(item.timestamp)}{formatSize(item.size) ? ` · ${formatSize(item.size)}` : ''}</p>
                            <p className="theme-muted mt-1 line-clamp-2 break-words text-xs">{item.messageContent || 'Shared in a message'}</p>
                          </div>
                          <span className="theme-muted shrink-0 text-[10px] capitalize">{item.mediaType}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-end gap-1 border-t border-white/10 pt-2">
                          <button type="button" onClick={() => toggleSaved(item)} aria-label={saved ? 'Remove saved message' : 'Save message'} title={saved ? 'Remove saved message' : 'Save message'} className={`grid h-8 w-8 place-items-center rounded hover:bg-white/10 ${saved ? 'text-amber-300' : 'theme-muted'}`}><FaStar /></button>
                          <button type="button" onClick={() => downloadItem(item)} aria-label={item.mediaType === 'link' ? 'Open link' : 'Download file'} title={item.mediaType === 'link' ? 'Open link' : 'Download'} className="theme-muted grid h-8 w-8 place-items-center rounded hover:bg-white/10"><FaDownload /></button>
                          <button type="button" onClick={() => jumpToMessage(item)} className="flex h-8 items-center gap-2 rounded px-2 text-xs text-accent-text hover:bg-white/10"><FaExternalLinkAlt /> Jump to message</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>}
        </div>
        <footer className="flex shrink-0 items-center justify-between border-t border-white/10 px-4 py-3 text-xs sm:px-5">
          <span className="theme-muted">Page {page}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label="Previous page" className="rounded border border-white/15 px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button type="button" disabled={!hasMore || loading} onClick={() => setPage((current) => current + 1)} aria-label="Next page" className="rounded border border-white/15 px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </footer>
      </section>
    </div>
  );
}