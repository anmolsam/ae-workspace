import { useState } from 'react';
import type { FollowUp } from '../../lib/types';
import { formatTime, overdueByLabel } from '../../lib/format';

interface CompactFollowUpRowProps {
  followUp: FollowUp;
  pending: boolean;
  onCheck: (fu: FollowUp) => void;
  onUncheck: (fu: FollowUp) => void;
}

function status(fu: FollowUp): { text: string; tone: 'danger' | 'muted' | 'success' } {
  if (fu.state === 'COMPLETED_VERIFIED') return { text: 'Verified', tone: 'success' };
  if (fu.checked || fu.state === 'MANUALLY_CHECKED_PENDING_VERIFICATION') return { text: 'Pending', tone: 'muted' };
  if (fu.overdue) return { text: overdueByLabel(fu.overdueAt), tone: 'danger' };
  const t = formatTime(fu.overdueAt);
  return { text: t ? `Due ${t}` : 'Due today', tone: 'muted' };
}

/**
 * Dense, single-glance follow-up row for the one-page Taskee. Everything the AE
 * needs to triage is on one line (checkbox, company, type, due/overdue); the
 * AI draft + HubSpot link reveal inline on click.
 */
export function CompactFollowUpRow({ followUp, pending, onCheck, onUncheck }: CompactFollowUpRowProps) {
  const [open, setOpen] = useState(false);
  const verified = followUp.state === 'COMPLETED_VERIFIED';
  const done = followUp.checked || verified;
  const s = status(followUp);
  const toneClass = s.tone === 'danger' ? 'text-danger' : s.tone === 'success' ? 'text-success' : 'text-ink-subtle';

  const toggle = () => {
    if (verified || pending) return;
    if (followUp.checked) onUncheck(followUp);
    else onCheck(followUp);
  };

  return (
    <div className={`rounded-md border px-2.5 py-2 transition-colors ${done ? 'border-line/60 bg-canvas/40' : 'border-line bg-surface hover:border-ink-subtle/40'}`}>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          disabled={verified || pending}
          aria-label={followUp.checked ? 'Uncheck' : 'Mark done'}
          className={`flex h-4 w-4 flex-none items-center justify-center rounded border transition-colors ${
            done ? 'border-success bg-success text-white' : 'border-line hover:border-ink-subtle'
          } ${pending ? 'opacity-60' : ''}`}
        >
          {done && (
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 6.5l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`truncate text-sm font-medium text-ink ${done ? 'line-through decoration-ink-subtle' : ''}`}>
            {followUp.companyName}
          </span>
          <span className="hidden truncate text-xs text-ink-subtle sm:inline">{followUp.followUpLabel}</span>
        </button>

        <span className={`flex-none text-xs font-medium tabular-nums ${toneClass}`}>{s.text}</span>
        <svg
          width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"
          onClick={() => setOpen((v) => !v)}
          className={`flex-none cursor-pointer text-ink-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          <p className="text-xs text-ink-subtle sm:hidden">{followUp.followUpLabel} · {followUp.stageLabel}</p>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-canvas p-2 text-xs text-ink-muted">
            {followUp.draft || 'No draft available.'}
          </div>
          <a
            href={followUp.hubspotDealUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded border border-line px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
          >
            Open Deal in HubSpot ↗
          </a>
        </div>
      )}
    </div>
  );
}
