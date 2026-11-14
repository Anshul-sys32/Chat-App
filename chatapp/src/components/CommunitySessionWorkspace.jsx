import React, { Suspense, lazy, useEffect, useState } from 'react';
import axios from 'axios';
import Socket from '../Socket';
import CommunityWhiteboard from './CommunityWhiteboard';

const CommunityCodeRoom = lazy(() => import('./CommunityCodeRoom'));
const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';

export default function CommunitySessionWorkspace({ session, groupName, user, onBack, onSessionUpdated }) {
  const [participants, setParticipants] = useState([]);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const isCreator = String(session.creatorId) === String(user?._id);
  const authConfig = () => ({
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    withCredentials: true,
  });

  useEffect(() => {
    setParticipants([]);
    setError('');
    setAccessDenied(false);
    const matches = (payload) => String(payload.sessionId) === String(session.id);
    const handleParticipants = (payload) => {
      if (matches(payload)) setParticipants(payload.participants || []);
    };
    const handleJoined = (payload) => {
      if (!matches(payload)) return;
      setAccessDenied(false);
      setParticipants((current) => current.some((person) => String(person.userId) === String(user?._id))
        ? current
        : [...current, { userId: user?._id, userName: user?.username || 'You' }]);
    };
    const handleSessionError = (payload) => {
      if (!matches(payload)) return;
      setAccessDenied(true);
      setError(payload.message || 'You do not have permission to collaborate in this session.');
    };
    const handleParticipantJoined = (payload) => {
      if (!matches(payload)) return;
      setParticipants((current) => current.some((person) => String(person.userId) === String(payload.userId))
        ? current
        : [...current, { userId: payload.userId, userName: payload.userName }]);
    };
    const handleParticipantLeft = (payload) => {
      if (matches(payload)) setParticipants((current) => current.filter((person) => String(person.userId) !== String(payload.userId)));
    };
    const handleClosed = (payload) => {
      if (!matches(payload)) return;
      onSessionUpdated(payload);
      setError('This session has been closed and is now read-only.');
    };
    Socket.on('collab-session-participants', handleParticipants);
    Socket.on('collab-session-joined', handleJoined);
    Socket.on('collab-session-error', handleSessionError);
    Socket.on('collab-session-participant-joined', handleParticipantJoined);
    Socket.on('collab-session-participant-left', handleParticipantLeft);
    Socket.on('collab-session-closed', handleClosed);
    return () => {
      Socket.off('collab-session-participants', handleParticipants);
      Socket.off('collab-session-joined', handleJoined);
      Socket.off('collab-session-error', handleSessionError);
      Socket.off('collab-session-participant-joined', handleParticipantJoined);
      Socket.off('collab-session-participant-left', handleParticipantLeft);
      Socket.off('collab-session-closed', handleClosed);
    };
  }, [session.id, onSessionUpdated, user?._id, user?.username]);

  const closeSession = async () => {
    if (!window.confirm(`Close “${session.name}”? Participants will no longer be able to edit it.`)) return;
    setClosing(true);
    setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/collab-sessions/${session.id}/close`, {}, authConfig());
      onSessionUpdated(data.session);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not close this session.');
    } finally {
      setClosing(false);
    }
  };

  return (
    <section className="community-session-workspace theme-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border" aria-label={`${session.name} collaborative workspace`}>
      <header className="community-session-workspace-header theme-border flex shrink-0 flex-wrap items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="theme-muted text-[11px]">{groupName} · #{session.channelName || 'channel'}</p>
          <p className="mt-1 max-w-3xl break-words text-sm">{session.summary}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Session participants">
            {participants.length ? participants.map((participant) => <span key={participant.userId} className="community-session-participant rounded px-2 py-1 text-[11px]">{String(participant.userId) === String(user?._id) ? 'You' : participant.userName}</span>) : <span className="theme-muted text-[11px]">{Socket.connected ? 'No other participants' : 'Reconnecting…'}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isCreator && session.status === 'active' && <button type="button" onClick={closeSession} disabled={closing} className="session-close-action rounded px-3 py-2 text-xs font-semibold disabled:opacity-50">{closing ? 'Closing…' : 'Close session'}</button>}
          <button type="button" onClick={onBack} className="theme-border rounded border px-3 py-2 text-xs font-medium hover:bg-accent-soft">Back to conversation</button>
        </div>
      </header>
      {error && <p role="status" className="theme-muted shrink-0 px-4 py-2 text-xs">{error}</p>}
      {session.sessionType === 'code_room' ? (
        <Suspense fallback={<p role="status" className="theme-muted p-4 text-sm">Loading Code Room…</p>}>
          <CommunityCodeRoom
            groupId={session.groupId}
            groupName={groupName}
            userName={user?.username}
            sessionId={session.id}
            session={session}
            readOnly={accessDenied}
            embedded
            onClose={onBack}
          />
        </Suspense>
      ) : (
        <CommunityWhiteboard
          groupId={session.groupId}
          sessionId={session.id}
          session={session}
          readOnly={accessDenied}
          embedded
          onClose={onBack}
        />
      )}
    </section>
  );
}
