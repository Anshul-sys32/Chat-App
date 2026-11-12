import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { FaArrowRight, FaCircle, FaPencilAlt, FaSquare, FaStickyNote, FaTimes, FaTrash } from 'react-icons/fa';
import Socket from '../Socket';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';
const COLORS = ['#263746', '#dc6b4a', '#268b79', '#d2a33e', '#7186d5', '#e7e2d5'];
const STICKY_COLORS = { yellow: '#f1d77a', mint: '#9ad9c0', pink: '#eca6b0', blue: '#9bbde4' };
const authConfig = () => ({
  headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
  withCredentials: true,
});

export default function CommunityWhiteboard({ groupId, sessionId = null, session = null, readOnly = false, embedded = false, onClose }) {
  const isSession = Boolean(sessionId);
  const isReadOnly = readOnly || session?.status === 'closed';
  const boardUrl = isSession
    ? `${API_URL}/api/collab-sessions/${sessionId}/whiteboard`
    : `${API_URL}/api/groups/${groupId}/whiteboard`;
  const [items, setItems] = useState([]);
  const [remoteStrokes, setRemoteStrokes] = useState({});
  const [tool, setTool] = useState('stroke');
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [stickyColor, setStickyColor] = useState('yellow');
  const [stickyText, setStickyText] = useState('');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(Socket.connected);
  const [error, setError] = useState('');
  const svgRef = useRef(null);

  useEffect(() => {
    let active = true;
    setItems([]);
    setRemoteStrokes({});
    setLoading(true);
    setError('');
    axios.get(boardUrl, authConfig())
      .then(({ data }) => { if (active) setItems(data.items || []); })
      .catch((requestError) => { if (active) setError(requestError.response?.data?.message || 'Could not load the whiteboard.'); })
      .finally(() => { if (active) setLoading(false); });
    const upsert = (item) => setItems((previous) => previous.some((entry) => String(entry.id) === String(item.id))
      ? previous.map((entry) => String(entry.id) === String(item.id) ? item : entry)
      : [...previous, item]);
    const matchesBoard = (payload) => isSession
      ? String(payload.sessionId) === String(sessionId)
      : String(payload.groupId) === String(groupId);
    const handleCreated = (payload) => { if (matchesBoard(payload)) upsert(payload.item); };
    const handleUpdated = (payload) => { if (matchesBoard(payload)) upsert(payload.item); };
    const handleDeleted = (payload) => {
      if (!matchesBoard(payload)) return;
      const { itemId } = payload;
      setItems((previous) => previous.filter((item) => String(item.id) !== String(itemId)));
    };
    const handleRemoteStroke = (stroke) => {
      if (!(isSession ? String(stroke.sessionId) === String(sessionId) : String(stroke.groupId) === String(groupId)) || stroke.socketId === Socket.id) return;
      if (stroke.finished) {
        setRemoteStrokes((previous) => {
          const next = { ...previous };
          delete next[stroke.socketId];
          return next;
        });
        return;
      }
      setRemoteStrokes((previous) => ({
        ...previous,
        [stroke.socketId]: {
          ...stroke,
          points: [...(previous[stroke.socketId]?.points || []), ...stroke.points].slice(-150),
        },
      }));
    };
    const handleSocketDisconnect = () => setRemoteStrokes({});
    const joinSession = () => {
      setConnected(Socket.connected);
      if (isSession && Socket.connected) Socket.emit('collab-session-join', { sessionId });
    };
    const handleDisconnect = () => {
      setConnected(false);
      handleSocketDisconnect();
    };
    const strokeEvent = isSession ? 'collab-whiteboard-stroke' : 'whiteboard-stroke';
    Socket.on('whiteboard-item-created', handleCreated);
    Socket.on('whiteboard-item-updated', handleUpdated);
    Socket.on('whiteboard-item-deleted', handleDeleted);
    Socket.on(strokeEvent, handleRemoteStroke);
    Socket.on('disconnect', handleDisconnect);
    if (Socket.connected) joinSession();
    Socket.on('connect', joinSession);
    return () => {
      active = false;
      if (isSession && Socket.connected) Socket.emit('collab-session-leave', { sessionId });
      Socket.off('whiteboard-item-created', handleCreated);
      Socket.off('whiteboard-item-updated', handleUpdated);
      Socket.off('whiteboard-item-deleted', handleDeleted);
      Socket.off(strokeEvent, handleRemoteStroke);
      Socket.off('disconnect', handleDisconnect);
      Socket.off('connect', joinSession);
    };
  }, [groupId, sessionId, boardUrl, isSession]);

  const pointFromEvent = (event) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000)),
      y: Math.max(0, Math.min(600, ((event.clientY - bounds.top) / bounds.height) * 600)),
    };
  };

  const saveItem = async (itemType, data) => {
    if (isReadOnly) return;
    setSaving(true);
    setError('');
    try {
      const { data: response } = await axios.post(boardUrl, { itemType, data }, authConfig());
      setItems((previous) => previous.some((item) => String(item.id) === String(response.item.id)) ? previous : [...previous, response.item]);
      setSelectedItemId(String(response.item.id));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save this whiteboard item.');
    } finally {
      setSaving(false);
    }
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0 || saving || isReadOnly) return;
    const point = pointFromEvent(event);
    if (tool === 'sticky') {
      if (!stickyText.trim()) {
        setError('Enter text for the sticky note first.');
        return;
      }
      saveItem('sticky', { ...point, text: stickyText.trim(), color: stickyColor });
      setStickyText('');
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'stroke') setDrawing({ type: tool, points: [point] });
    else setDrawing({ type: tool, start: point, end: point });
    setSelectedItemId(null);
  };

  const handlePointerMove = (event) => {
    if (!drawing) return;
    const point = pointFromEvent(event);
    if (drawing.type === 'stroke') {
      setDrawing((current) => current && ({ ...current, points: [...current.points, point] }));
      Socket.emit(isSession ? 'collab-whiteboard-stroke' : 'whiteboard-stroke', { groupId, ...(isSession ? { sessionId } : {}), points: [point], color, width: strokeWidth });
    }
    else setDrawing((current) => current && ({ ...current, end: point }));
  };

  const handlePointerUp = async (event) => {
    if (!drawing) return;
    const finalPoint = pointFromEvent(event);
    const current = drawing;
    setDrawing(null);
    if (current.type === 'stroke') {
      Socket.emit(isSession ? 'collab-whiteboard-stroke' : 'whiteboard-stroke', { groupId, ...(isSession ? { sessionId } : {}), points: [], color, width: strokeWidth, finished: true });
      if (current.points.length < 2) return;
      await saveItem('stroke', { points: [...current.points, finalPoint], color, width: strokeWidth });
      return;
    }
    const x = Math.min(current.start.x, finalPoint.x);
    const y = Math.min(current.start.y, finalPoint.y);
    const width = Math.abs(finalPoint.x - current.start.x);
    const height = Math.abs(finalPoint.y - current.start.y);
    if (width < 2 || height < 2) return;
    if (current.type === 'arrow') {
      await saveItem('arrow', { x1: current.start.x, y1: current.start.y, x2: finalPoint.x, y2: finalPoint.y, color, width: strokeWidth });
    } else {
      await saveItem(current.type, { x, y, width, height, color, strokeWidth });
    }
  };

  const deleteSelected = async () => {
    if (!selectedItemId || isReadOnly) return;
    setError('');
    try {
      await axios.delete(`${boardUrl}/${selectedItemId}`, authConfig());
      setItems((previous) => previous.filter((item) => String(item.id) !== selectedItemId));
      setSelectedItemId(null);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete this item.');
    }
  };

  const pointString = (points) => points.map((point) => `${point.x},${point.y}`).join(' ');
  const previewData = drawing?.type === 'stroke'
    ? { points: drawing.points, color, width: strokeWidth }
    : drawing && drawing.type === 'arrow'
      ? { x1: drawing.start.x, y1: drawing.start.y, x2: drawing.end.x, y2: drawing.end.y, color, width: strokeWidth }
      : drawing
        ? { x: Math.min(drawing.start.x, drawing.end.x), y: Math.min(drawing.start.y, drawing.end.y), width: Math.abs(drawing.end.x - drawing.start.x), height: Math.abs(drawing.end.y - drawing.start.y), color, strokeWidth }
        : null;

  return (
    <div className={embedded ? 'min-h-0 flex flex-1 flex-col' : 'fixed inset-0 z-[98] flex items-center justify-center bg-black/65 p-2 sm:p-5'} onMouseDown={(event) => { if (!embedded && event.target === event.currentTarget) onClose(); }}>
      <section role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby="whiteboard-title" className={`theme-panel flex ${embedded ? 'min-h-0 flex-1' : 'max-h-[94dvh] w-full max-w-6xl'} flex-col overflow-hidden rounded-xl border shadow-2xl`}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b theme-border px-4 py-3">
          <div>
            <h2 id="whiteboard-title" className="text-sm font-semibold">{session?.name || 'Community whiteboard'}</h2>
            <p className="theme-muted mt-0.5 text-xs">{isReadOnly ? 'Closed · read-only' : connected ? 'Connected · changes sync live' : 'Reconnecting…'} · {items.length} items</p>
          </div>
          {!embedded && <button type="button" onClick={onClose} aria-label="Close whiteboard" title="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><FaTimes /></button>}
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b theme-border p-2">
          {!isReadOnly && [
            ['stroke', <FaPencilAlt />, 'Draw'],
            ['rectangle', <FaSquare />, 'Rectangle'],
            ['ellipse', <FaCircle />, 'Ellipse'],
            ['arrow', <FaArrowRight />, 'Arrow'],
            ['sticky', <FaStickyNote />, 'Sticky note'],
          ].map(([value, icon, label]) => (
            <button key={value} type="button" onClick={() => setTool(value)} aria-pressed={tool === value} title={label} className={`inline-flex h-8 items-center gap-2 rounded border px-2.5 text-xs ${tool === value ? 'border-accent-border bg-accent/20 text-accent-text' : 'theme-border text-white/65 hover:bg-white/10'}`}>
              {icon}<span>{label}</span>
            </button>
          ))}
          {!isReadOnly && (tool === 'sticky' ? (
            <>
              <input value={stickyText} onChange={(event) => setStickyText(event.target.value)} maxLength={2000} placeholder="Sticky note text, then click board" aria-label="Sticky note text" className="min-w-36 flex-1 rounded border theme-border theme-control px-2 py-1.5 text-xs sm:max-w-72" />
              <select value={stickyColor} onChange={(event) => setStickyColor(event.target.value)} aria-label="Sticky note color" className="rounded border theme-border theme-control px-2 py-1.5 text-xs">
                {Object.keys(STICKY_COLORS).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1" role="group" aria-label="Drawing color">
                {COLORS.map((value) => <button key={value} type="button" onClick={() => setColor(value)} aria-label={`Use ${value}`} aria-pressed={color === value} className={`h-6 w-6 rounded-full border-2 ${color === value ? 'border-white' : 'theme-border'}`} style={{ backgroundColor: value }} />)}
              </div>
              <input type="range" min="1" max="18" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} aria-label="Stroke width" className="w-20 accent-accent" />
            </>
          ))}
          {!isReadOnly && <button type="button" onClick={deleteSelected} disabled={!selectedItemId} title="Delete selected item" aria-label="Delete selected item" className="ml-auto grid h-8 w-8 place-items-center rounded border theme-border text-white/55 hover:text-rose-200 disabled:opacity-30"><FaTrash /></button>}
        </div>
        {error && <p role="alert" className="px-3 pt-2 text-xs text-rose-200">{error}</p>}
        <div className="min-h-0 overflow-auto p-2 sm:p-4">
          <svg
            ref={svgRef}
            viewBox="0 0 1000 600"
            preserveAspectRatio="none"
            className="block aspect-[5/3] w-full touch-none rounded border border-black/10 bg-[#f2f0e9]"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => setDrawing(null)}
            aria-label="Shared whiteboard canvas"
          >
            <defs>
              <pattern id="whiteboard-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#23343b" strokeOpacity="0.08" strokeWidth="1" /></pattern>
              <marker id="whiteboard-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="context-stroke" /></marker>
            </defs>
            <rect width="1000" height="600" fill="url(#whiteboard-grid)" pointerEvents="none" />
            {items.map((item) => {
              const selected = String(item.id) === selectedItemId;
              const common = { onPointerDown: (event) => event.stopPropagation(), onClick: (event) => { event.stopPropagation(); setSelectedItemId(String(item.id)); } };
              if (item.itemType === 'stroke') return <polyline key={item.id} {...common} points={pointString(item.data.points)} fill="none" stroke={item.data.color} strokeWidth={item.data.width} strokeLinecap="round" strokeLinejoin="round" opacity={selected ? 0.65 : 1} />;
              if (item.itemType === 'rectangle') return <rect key={item.id} {...common} x={item.data.x} y={item.data.y} width={item.data.width} height={item.data.height} fill={`${item.data.color}22`} stroke={item.data.color} strokeWidth={item.data.strokeWidth} />;
              if (item.itemType === 'ellipse') return <ellipse key={item.id} {...common} cx={item.data.x + item.data.width / 2} cy={item.data.y + item.data.height / 2} rx={item.data.width / 2} ry={item.data.height / 2} fill={`${item.data.color}22`} stroke={item.data.color} strokeWidth={item.data.strokeWidth} />;
              if (item.itemType === 'arrow') return <line key={item.id} {...common} x1={item.data.x1} y1={item.data.y1} x2={item.data.x2} y2={item.data.y2} stroke={item.data.color} strokeWidth={item.data.width} markerEnd="url(#whiteboard-arrow)" />;
              return (
                <g key={item.id} {...common}>
                  <foreignObject x={item.data.x} y={item.data.y} width="220" height="140">
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{ height: '100%', overflow: 'hidden', background: STICKY_COLORS[item.data.color], color: '#25333a', padding: '12px', boxShadow: selected ? '0 0 0 3px var(--theme-accent)' : '0 4px 12px #172a3333', fontSize: '13px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {item.data.text}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
            {Object.values(remoteStrokes).map((stroke) => (
              <polyline key={stroke.socketId} points={pointString(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
            ))}
            {previewData && (drawing.type === 'stroke'
              ? <polyline points={pointString(previewData.points)} fill="none" stroke={previewData.color} strokeWidth={previewData.width} strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
              : drawing.type === 'arrow'
                ? <line x1={previewData.x1} y1={previewData.y1} x2={previewData.x2} y2={previewData.y2} stroke={previewData.color} strokeWidth={previewData.width} markerEnd="url(#whiteboard-arrow)" opacity="0.7" />
                : drawing.type === 'rectangle'
                  ? <rect x={previewData.x} y={previewData.y} width={previewData.width} height={previewData.height} fill={`${previewData.color}22`} stroke={previewData.color} strokeWidth={previewData.strokeWidth} />
                  : <ellipse cx={previewData.x + previewData.width / 2} cy={previewData.y + previewData.height / 2} rx={previewData.width / 2} ry={previewData.height / 2} fill={`${previewData.color}22`} stroke={previewData.color} strokeWidth={previewData.strokeWidth} />)}
          </svg>
        </div>
        {loading && <p role="status" className="theme-muted px-4 pb-3 text-xs">Loading saved board…</p>}
      </section>
    </div>
  );
}
