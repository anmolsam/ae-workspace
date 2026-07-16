import { useState } from 'react';
import type { FollowUp } from '../../lib/types';
import { formatTime, overdueByLabel, relativeGeneratedAt } from '../../lib/format';

interface FollowUpCardProps {
  followUp: FollowUp;
  pending: boolean;
  onCheck: (fu: FollowUp) => void;
  onUncheck: (fu: FollowUp) => void;
}

function statusLine(fu: FollowUp): { text: string; tone: 'danger' | 'muted' | 'success' } {
  if (fu.state === 'COMPLETED_VERIFIED') {
    return { text: 'Completed · Verified from HubSpot', tone: 'success' };
  }
  if (fu.checked || fu.state === 'MANUALLY_CHECKED_PENDING_VERIFICATION') {
    return { text: 'Verification pending', tone: 'muted' };
  }
  if (fu.overdue) {
    return { text: overdueByLabel(fu.overdueAt), tone: 'danger' };
  }
  const time = formatTime(fu.overdueAt);
  return { text: time ? `Due Today · ${time}` : 'Due Today', tone: 'muted' };
}

export function FollowUpCard({ followUp, pending, onCheck, onUncheck }: FollowUpCardProps) {
  const [expanded, setExpanded] = useState(false);
  const verified = followUp.state === 'COMPLETED_VERIFIED';
  const done = followUp.checked || verified;
  const status = statusLine(followUp);

  const toggle = () => {
    if (verified || pending) return;
    if (followUp.checked) onUncheck(followUp);
    else onCheck(followUp);
  };

  return (
    <div
      className={`rounded-card border bg-surface p-4 shadow-card transition-opacity ${
        done ? 'border-line/70 opacity-70' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={verified || pending}
          aria-label={followUp.checked ? 'Uncheck follow-up' : 'Check follow-up'}
          className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border transition-colors ${
            done
              ? 'border-success bg-success text-white'
              : 'border-line bg-surface hover:border-ink-subtle'
          } ${verified ? 'cursor-not-allowed' : ''} ${pending ? 'opacity-60' : ''}`}
        >
          {done && (
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M2.5 6.5l2.2 2.2 4.8-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={`truncate text-sm font-semibold text-ink ${
                done ? 'line-through decoration-ink-subtle' : ''
              }`}
            >
              {followUp.companyName}
            </span>
            <span className="truncate text-sm text-ink-muted">{followUp.dealName}</span>
          </div>

          <p className={`mt-0.5 text-sm text-ink ${done ? 'line-through decoration-ink-subtle' : ''}`}>
            {followUp.followUpLabel}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
            <span>{followUp.stageLabel}</span>
            <span
              className={`font-medium ${
                status.tone === 'danger'
                  ? 'text-danger'
                  : status.tone === 'success'
                    ? 'text-success'
                    : 'text-ink-muted'
              }`}
            >
              {status.text}
            </span>
            {followUp.draftGeneratedAt && (
              <span>Draft {relativeGeneratedAt(followUp.draftGeneratedAt)}</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-canvas"
            >
              {expanded ? 'Hide Draft' : 'View Draft'}
            </button>
            <a
              href={followUp.hubspotDealUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
            >
              Open Deal in HubSpot ↗
            </a>
          </div>

          <div
            className={`grid transition-all duration-200 ease-out ${
              expanded ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="overflow-hidden">
              <div className="whitespace-pre-wrap rounded-md border border-line bg-canvas p-3 text-sm text-ink-muted">
                {followUp.draft || 'No draft available.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
