import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FaDownload, FaExternalLinkAlt, FaFile, FaLink, FaStar, FaTimes, FaVolumeUp } from 'react-icons/fa';
import useDialogFocus from '../useDialogFocus';

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
  const [filters, setFilters] = useState({ search: '', mediaType: 'all', sender: '', from: '', to: '', sort: 'newest' });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [items, setItems] = useState([]);
  const [savedKeys, setSavedKeys] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewItem, setPreviewItem] = useState(null);
  const dialogRef = useDialogFocus(open && !previewItem, onClose);
  const previewDialogRef = useDialogFocus(Boolean(previewItem), () => setPreviewItem(null));

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
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="media-gallery-title" className="glass-panel flex max-h-[min(94dvh,60rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border shadow-2xl outline-none">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id="media-gallery-title" className="text-sm font-semibold">{conversation ? `Media · ${conversation.name || conversation.username || 'Conversation'}` : 'Media gallery'}</h2>
            <p className="theme-muted mt-0.5 text-xs">{conversation?.channelName ? `# ${conversation.channelName}` : 'Photos, files, audio, video, and links'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close media gallery" title="Close gallery" className="grid h-9 w-9 shrink-0 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
        </header>

        <form onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedFilters({ ...filters }); }} className="theme-border grid shrink-0 gap-3 border-b p-3 sm:px-5">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex">
            <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} maxLength={100} aria-label="Search media" placeholder="Search files or messages" className="theme-control col-span-2 min-w-0 rounded px-3 py-2 text-sm sm:col-span-1 sm:flex-1" />
            <label className="flex items-center gap-2 text-xs">
              <span className="theme-muted">Sort</span>
              <select value={filters.sort} onChange={(event) => { const sort = event.target.value; setFilters((current) => ({ ...current, sort })); setPage(1); setAppliedFilters((current) => ({ ...current, sort })); }} aria-label="Sort media" className="theme-control rounded px-2 py-2">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              </select>
            </label>
            <button type="submit" className="shrink-0 rounded bg-accent px-3 py-2 text-xs font-semibold text-accent-contrast">Apply</button>
          </div>
          <div className="gallery-type-filters flex min-w-0 gap-1 overflow-x-auto pb-0.5" role="group" aria-label="Filter by media type">
            {mediaOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filters.mediaType === value}
                onClick={() => {
                  setPage(1);
                  setFilters((current) => ({ ...current, mediaType: value }));
                  setAppliedFilters((current) => ({ ...current, mediaType: value }));
                }}
                className={`gallery-type-filter shrink-0 rounded px-3 py-1.5 text-xs ${filters.mediaType === value ? 'is-selected' : ''}`}
              >{label}</button>
            ))}
          </div>
          <details className="min-w-0 text-xs">
            <summary className="theme-muted w-fit cursor-pointer select-none rounded py-1 hover:text-accent-text">More filters</summary>
            <div className="mt-2 grid min-w-0 gap-2 sm:grid-cols-3">
              <label className="min-w-0">
                <span className="sr-only">Filter by sender</span>
                <input list="gallery-senders" value={filters.sender} onChange={(event) => setFilters((current) => ({ ...current, sender: event.target.value }))} maxLength={80} aria-label="Filter by sender" placeholder="Sender name" className="theme-control w-full min-w-0 rounded px-3 py-2" />
                <datalist id="gallery-senders">{[...new Set(items.map((item) => item.senderName).filter(Boolean))].map((name) => <option key={name} value={name} />)}</datalist>
              </label>
              <input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} aria-label="From date" className="theme-control min-w-0 rounded px-2 py-2" />
              <input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} aria-label="To date" className="theme-control min-w-0 rounded px-2 py-2" />
            </div>
          </details>
        </form>

        {error && <p role="alert" className="mx-4 mt-3 rounded border border-rose-300/20 bg-rose-950/30 px-3 py-2 text-sm text-rose-200 sm:mx-5">{error}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {loading ? <p role="status" className="theme-muted py-12 text-center text-sm">Loading media…</p>
            : items.length === 0 ? <p className="theme-muted py-12 text-center text-sm">{error ? 'Media is unavailable.' : 'No media matches these filters.'}</p>
              : <ul className="gallery-media-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {items.map((item, index) => {
                  const key = `${item.messageType}:${item.messageId}:${item.url}:${index}`;
                  const saved = savedKeys.has(saveKey(item));
                  return (
                    <li key={key} className="gallery-media-card theme-border flex min-w-0 flex-col overflow-hidden rounded-md border">
                      <div className={`gallery-media-preview grid place-items-center overflow-hidden ${['document', 'file'].includes(item.mediaType) ? 'is-file' : ''} ${item.mediaType === 'video' ? 'is-video' : ''} ${item.mediaType === 'audio' ? 'is-audio' : ''} ${item.mediaType === 'link' ? 'is-link' : ''}`}>
                        {item.mediaType === 'image' && <button type="button" onClick={() => setPreviewItem(item)} aria-label={`Preview ${item.name || 'shared image'}`} title="Open image preview" className="gallery-image-preview h-full w-full"><img src={mediaUrl(item)} alt={item.name || 'Shared image'} loading="lazy" crossOrigin="use-credentials" className="h-full w-full object-cover" /></button>}
                        {item.mediaType === 'video' && <video src={mediaUrl(item)} controls preload="metadata" crossOrigin="use-credentials" className="h-full w-full object-contain" aria-label={item.name || 'Shared video'} />}
                        {item.mediaType === 'audio' && <div className="w-full px-4"><FaVolumeUp className="theme-muted mx-auto mb-3 text-2xl" /><audio src={mediaUrl(item)} controls preload="none" crossOrigin="use-credentials" className="w-full" aria-label={item.name || 'Shared audio'} /></div>}
                        {item.mediaType === 'link' && <a href={item.url} target="_blank" rel="noreferrer" className="flex max-h-full w-full flex-col items-center justify-center gap-3 overflow-hidden p-4 text-center text-accent-text"><FaLink className="shrink-0 text-2xl" /><span className="line-clamp-3 break-all text-sm">{item.url}</span></a>}
                        {!['image', 'video', 'audio', 'link'].includes(item.mediaType) && <div className="flex min-w-0 items-center gap-3 px-4 py-5"><FaFile className="theme-muted shrink-0 text-2xl" /><div className="min-w-0"><span className="block break-all text-sm font-medium">{item.name || 'Shared file'}</span>{formatSize(item.size) && <span className="theme-muted mt-1 block text-xs">{formatSize(item.size)}</span>}</div></div>}
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col p-3">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium" title={item.name}>{item.name || item.url}</p>
                            <p className="theme-muted mt-1 truncate text-[11px]">{item.senderName} · {displayDate(item.timestamp)}</p>
                            <p className="theme-muted mt-1 line-clamp-2 break-words text-xs">{item.messageContent || 'Shared in a message'}</p>
                          </div>
                          <span className="gallery-type-label theme-muted shrink-0 rounded px-1.5 py-1 text-[10px] capitalize">{item.mediaType}</span>
                        </div>
                        <div className="theme-border mt-auto flex items-center justify-end gap-1 border-t pt-2">
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
      {previewItem && (
        <div className="theme-overlay fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewItem(null); }}>
          <section ref={previewDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="gallery-preview-title" className="gallery-preview-dialog flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border outline-none">
            <header className="theme-border flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
              <h3 id="gallery-preview-title" className="min-w-0 truncate text-sm font-medium">{previewItem.name || 'Shared image'}</h3>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => downloadItem(previewItem)} aria-label="Download image" title="Download image" className="theme-icon-button grid h-9 w-9 place-items-center rounded"><FaDownload /></button>
                <button type="button" onClick={() => setPreviewItem(null)} aria-label="Close image preview" title="Close preview" className="theme-icon-button grid h-9 w-9 place-items-center rounded"><FaTimes /></button>
              </div>
            </header>
            <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-2 sm:p-4">
              <img src={mediaUrl(previewItem)} alt={previewItem.name || 'Shared image'} crossOrigin="use-credentials" className="max-h-[calc(94dvh-7rem)] max-w-full object-contain" />
            </div>
            <p className="theme-muted px-4 pb-3 text-xs">{previewItem.senderName} · {displayDate(previewItem.timestamp)}</p>
          </section>
        </div>
      )}
    </div>
  );
}