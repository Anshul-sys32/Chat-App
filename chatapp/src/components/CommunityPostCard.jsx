import React, { useEffect, useState } from 'react';
import MarkdownMessage from './MarkdownMessage';

const formatEventTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time not set' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

export default function CommunityPostCard({ message, threadCount, onVote, onRsvp, onOpenThread }) {
  const [selectedOptions, setSelectedOptions] = useState(message.pollResults?.selected || []);
  const data = message.structuredData || {};

  useEffect(() => {
    setSelectedOptions(message.pollResults?.selected || []);
  }, [message._id, message.pollResults?.selected]);

  const toggleOption = (index) => {
    setSelectedOptions((current) => data.multipleChoice
      ? current.includes(index) ? current.filter((value) => value !== index) : [...current, index]
      : [index]);
  };

  if (message.messageType === 'poll') {
    const counts = message.pollResults?.counts || [];
    const total = counts.reduce((sum, count) => sum + count, 0);
    const closed = data.endsAt && Date.parse(data.endsAt) <= Date.now();
    return (
      <section className="mt-2 min-w-0 rounded-lg border border-sky-300/20 bg-sky-950/25 p-3" aria-label="Community poll">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase text-sky-200">Poll</span>
          <span className="text-[10px] text-white/45">{total} vote{total === 1 ? '' : 's'}{closed ? ' · closed' : ''}</span>
        </div>
        <h3 className="mb-2 font-semibold leading-5">{data.question || message.content}</h3>
        <div className="space-y-1.5">
          {(data.options || []).map((option, index) => {
            const count = counts[index] || 0;
            const percentage = total ? Math.round((count / total) * 100) : 0;
            return (
              <label key={`${index}-${option}`} className="relative flex cursor-pointer items-center gap-2 overflow-hidden rounded border theme-border px-2.5 py-2 text-xs">
                <span className="absolute inset-y-0 left-0 bg-sky-400/10" style={{ width: `${percentage}%` }} />
                <input
                  type={data.multipleChoice ? 'checkbox' : 'radio'}
                  name={`poll-${message._id}`}
                  checked={selectedOptions.includes(index)}
                  onChange={() => toggleOption(index)}
                  disabled={Boolean(closed)}
                  className="relative accent-sky-400"
                />
                <span className="relative min-w-0 flex-1 break-words">{option}</span>
                <span className="relative tabular-nums text-white/60">{percentage}%</span>
              </label>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-white/45">{data.multipleChoice ? 'Select all that apply' : 'Choose one'}{data.endsAt ? ` · closes ${formatEventTime(data.endsAt)}` : ''}</span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => onOpenThread(message)} className="text-[10px] text-sky-200/75 hover:text-white">Discuss</button>
            <button type="button" onClick={() => onVote(message, selectedOptions)} disabled={!selectedOptions.length || Boolean(closed)} className="rounded bg-sky-500 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 disabled:opacity-40">Vote</button>
          </div>
        </div>
      </section>
    );
  }

  if (message.messageType === 'event') {
    const results = message.eventResults || {};
    return (
      <section className="mt-2 min-w-0 rounded-lg border border-emerald-300/20 bg-emerald-950/20 p-3" aria-label="Community event">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase text-emerald-200">Community event</span>
          <time className="text-right text-[10px] text-white/55">{formatEventTime(data.startsAt)}</time>
        </div>
        <h3 className="font-semibold leading-5">{data.title || message.content}</h3>
        {data.location && <p className="mt-1 text-xs text-white/60">{data.location}</p>}
        {data.description && <div className="mt-1"><MarkdownMessage>{data.description}</MarkdownMessage></div>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            ['going', 'Going', results.going || 0],
            ['maybe', 'Maybe', results.maybe || 0],
            ['not_going', 'Can’t go', results.notGoing || 0],
          ].map(([response, label, count]) => (
            <button
              key={response}
              type="button"
              onClick={() => onRsvp(message, response)}
              aria-pressed={results.myResponse === response}
              className={`rounded border px-2.5 py-1.5 text-[11px] ${results.myResponse === response ? 'border-emerald-300/60 bg-emerald-300/15 text-emerald-100' : 'theme-border text-white/70 hover:bg-white/5'}`}
            >
              {label} · {count}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => onOpenThread(message)} className="mt-2 text-[10px] text-sky-200/75 hover:text-white">Discuss</button>
      </section>
    );
  }

  return (
    <div className="min-w-0">
      {message.messageType === 'question' && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-100">Question</span>
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-white/55">{data.category || 'General'}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${message.acceptedAnswerId ? 'bg-emerald-300/10 text-emerald-200' : 'bg-amber-300/10 text-amber-100'}`}>
            {message.acceptedAnswerId ? 'Solved' : 'Unsolved'}
          </span>
          {(data.tags || []).map((tag) => <span key={tag} className="rounded bg-sky-300/10 px-1.5 py-0.5 text-[9px] text-sky-200">#{tag}</span>)}
        </div>
      )}
      <MarkdownMessage>{message.content}</MarkdownMessage>
      {message.messageType === 'question' && (
          <button type="button" onClick={() => onOpenThread(message)} className="mt-2 text-[11px] font-medium text-sky-200 hover:text-white">
            {threadCount ? `Open discussion · ${threadCount} repl${threadCount === 1 ? 'y' : 'ies'}` : 'Start technical discussion'}
        </button>
      )}
    </div>
  );
}