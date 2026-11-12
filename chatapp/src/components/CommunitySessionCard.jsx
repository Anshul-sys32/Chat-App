import React from 'react';
import { FaCode, FaPencilAlt } from 'react-icons/fa';

const sessionLabel = (session) => session.sessionType === 'code_room' ? 'Code Room' : 'Whiteboard';

export default function CommunitySessionCard({ session, currentUserId, onJoin }) {
  const isCodeRoom = session.sessionType === 'code_room';
  const Icon = isCodeRoom ? FaCode : FaPencilAlt;
  const isCreator = String(session.creatorId) === String(currentUserId);
  const isClosed = session.status === 'closed';

  return (
    <article className={`community-session-card ${isCodeRoom ? 'is-code-room' : 'is-whiteboard'} ${isClosed ? 'is-closed' : ''}`} aria-label={`${session.name} ${sessionLabel(session)}`}>
      <div className="community-session-card-icon" aria-hidden="true"><Icon /></div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 break-words text-sm font-semibold">{session.name}</h3>
          <span className="community-session-type">{sessionLabel(session)}</span>
        </div>
        <p className="theme-muted mt-1 text-xs">{session.creatorName || 'Community member'} started a {sessionLabel(session)}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{session.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`community-session-status ${isClosed ? 'is-closed' : 'is-active'}`}><span aria-hidden="true" />{isClosed ? 'Closed' : 'Active'}</span>
          {isCreator && <span className="theme-muted text-[11px]">You started this session</span>}
        </div>
      </div>
      <button type="button" onClick={() => onJoin(session)} className="community-session-action shrink-0 rounded px-3 py-2 text-xs font-semibold">
        {isClosed ? 'View closed session' : isCodeRoom ? 'Join session' : 'Open whiteboard'}
      </button>
    </article>
  );
}
