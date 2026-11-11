import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { MonacoBinding } from 'y-monaco';
import { FaCode, FaTimes } from 'react-icons/fa';
import Socket from '../Socket';

const CODE_ROOM_LANGUAGES = ['javascript', 'typescript', 'python', 'java', 'html', 'css', 'json', 'sql', 'markdown'];
const CURSOR_COLORS = ['#e66c4a', '#368f7a', '#d2a33e', '#7186d5', '#ba6790', '#478eb8'];
const asBytes = (value) => value instanceof Uint8Array ? value : value ? new Uint8Array(value) : new Uint8Array();

export default function CommunityCodeRoom({ groupId, groupName, userName, onClose }) {
  const [language, setLanguage] = useState('javascript');
  const [connected, setConnected] = useState(Socket.connected);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState('');
  const docRef = useRef(null);
  const awarenessRef = useRef(null);
  const bindingRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const localOrigin = useRef({});
  const userNameRef = useRef(userName);
  userNameRef.current = userName;

  useEffect(() => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const broadcastLocalAwareness = (ids = [...awareness.getStates().keys()]) => {
      if (!Socket.connected || !ids.length) return;
      Socket.emit('code-room-awareness', {
        groupId,
        update: encodeAwarenessUpdate(awareness, ids),
      });
    };
    docRef.current = doc;
    awarenessRef.current = awareness;
    const color = CURSOR_COLORS[doc.clientID % CURSOR_COLORS.length];
    awareness.setLocalStateField('user', { name: userNameRef.current || 'Community member', color });
    const bindEditor = () => {
      if (!editorRef.current || !monacoRef.current || bindingRef.current) return;
      bindingRef.current = new MonacoBinding(doc.getText('code'), editorRef.current.getModel(), new Set([editorRef.current]), awareness);
    };
    const handleSync = (payload) => {
      if (String(payload.groupId) !== String(groupId)) return;
      try {
        if (payload.update?.byteLength || payload.update?.length) Y.applyUpdate(doc, asBytes(payload.update), localOrigin.current);
        bindEditor();
        setSynced(true);
        setError('');
      } catch (requestError) {
        setError('The shared document could not be decoded.');
        console.error('Code room sync error:', requestError);
      }
    };
    const handleDocumentUpdate = (update, origin) => {
      if (origin !== localOrigin.current && Socket.connected) Socket.emit('code-room-update', { groupId, update });
    };
    const handleAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin !== localOrigin.current) broadcastLocalAwareness([...added, ...updated, ...removed]);
    };
    const handleAwareness = (payload) => {
      if (String(payload.groupId) !== String(groupId)) return;
      try { applyAwarenessUpdate(awareness, asBytes(payload.update), localOrigin.current); }
      catch (requestError) { console.error('Code room cursor update error:', requestError); }
    };
    const handleAwarenessRequest = ({ groupId: requestedGroupId }) => {
      if (String(requestedGroupId) === String(groupId)) broadcastLocalAwareness();
    };
    const handleJoined = ({ groupId: joinedGroupId }) => {
      if (String(joinedGroupId) === String(groupId)) broadcastLocalAwareness();
    };
    const joinRoom = () => {
      setConnected(Socket.connected);
      if (!Socket.connected) return;
      setSynced(false);
      Socket.emit('code-room-join', { groupId });
    };
    const handleError = (payload) => {
      if (String(payload.groupId) === String(groupId)) setError(payload.message || 'Code room connection failed.');
    };
    const handleDisconnect = () => setConnected(false);

    doc.on('update', handleDocumentUpdate);
    awareness.on('update', handleAwarenessUpdate);
    Socket.on('code-room-sync', handleSync);
    Socket.on('code-room-update', handleSync);
    Socket.on('code-room-awareness', handleAwareness);
    Socket.on('code-room-awareness-request', handleAwarenessRequest);
    Socket.on('code-room-joined', handleJoined);
    Socket.on('code-room-error', handleError);
    Socket.on('connect', joinRoom);
    Socket.on('disconnect', handleDisconnect);
    joinRoom();

    return () => {
      if (Socket.connected) Socket.emit('code-room-leave', { groupId });
      Socket.off('code-room-sync', handleSync);
      Socket.off('code-room-update', handleSync);
      Socket.off('code-room-awareness', handleAwareness);
      Socket.off('code-room-awareness-request', handleAwarenessRequest);
      Socket.off('code-room-joined', handleJoined);
      Socket.off('code-room-error', handleError);
      Socket.off('connect', joinRoom);
      Socket.off('disconnect', handleDisconnect);
      doc.off('update', handleDocumentUpdate);
      awareness.off('update', handleAwarenessUpdate);
      bindingRef.current?.destroy();
      bindingRef.current = null;
      awareness.destroy();
      doc.destroy();
      docRef.current = null;
      awarenessRef.current = null;
      editorRef.current = null;
      monacoRef.current = null;
    };
  }, [groupId]);

  useEffect(() => {
    awarenessRef.current?.setLocalStateField('user', {
      ...(awarenessRef.current.getLocalState()?.user || {}),
      name: userName || 'Community member',
    });
  }, [userName]);

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    if (!docRef.current || bindingRef.current) return;
    bindingRef.current = new MonacoBinding(docRef.current.getText('code'), editor.getModel(), new Set([editor]), awarenessRef.current);
  };

  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/70 p-2 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="code-room-title" className="glass-panel flex h-[min(94dvh,56rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded border border-white/10 text-accent-text"><FaCode /></span>
          <div className="min-w-0 flex-1">
            <h2 id="code-room-title" className="truncate text-sm font-semibold">{groupName} code room</h2>
            <p className="theme-muted mt-0.5 text-xs">{!connected ? 'Reconnecting…' : synced ? 'Connected · changes sync live' : 'Syncing shared document…'}</p>
          </div>
          <label className="sr-only" htmlFor="code-room-language">Language</label>
          <select id="code-room-language" value={language} onChange={(event) => setLanguage(event.target.value)} className="rounded border border-white/10 bg-slate-900 px-2 py-1.5 text-xs">
            {CODE_ROOM_LANGUAGES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button type="button" onClick={onClose} aria-label="Close code room" title="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><FaTimes /></button>
        </header>
        {error && <p role="alert" className="border-b border-rose-300/10 px-4 py-2 text-xs text-rose-200">{error}</p>}
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            onMount={handleEditorMount}
            options={{
              readOnly: !connected || !synced,
              automaticLayout: true,
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 2,
              padding: { top: 14 },
            }}
          />
        </div>
      </section>
    </div>
  );
}
