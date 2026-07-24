import { useState } from 'react';
import type { Meeting } from '../../lib/types';
import { formatDateTime, humanizeTimeRemaining } from '../../lib/format';
import { useBrief } from '../../hooks/useBrief';
import { BriefStatusChip } from './BriefStatusChip';
import { BriefDetailView } from './BriefDetailView';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonText } from '../ui/Skeleton';

interface CompactMeetingRowProps {
  meeting: Meeting;
  onGenerated: () => void;
}

/**
 * Dense, single-glance meeting row for the one-page Briefy. Company + date +
 * brief-status on one line; the full pre-call brief (shashank's 7 sections)
 * reveals inline on click.
 */
export function CompactMeetingRow({ meeting, onGenerated }: CompactMeetingRowProps) {
  const [open, setOpen] = useState(false);
  const { brief, loading, polling, error, generate } = useBrief(meeting.id, meeting.briefId, { onGenerated });

  const canGenerate = meeting.briefStatus === 'needs_generation';
  const isGenerating =
    polling || meeting.briefStatus === 'generating' || brief?.jobStatus === 'queued' || brief?.jobStatus === 'processing';
  const failed = brief?.jobStatus === 'failed';
  const hasDetail = Boolean(brief?.sectionStatus);

  return (
    <div className="rounded-md border border-line bg-surface transition-colors hover:border-ink-subtle/40">
      <div className="flex w-full items-center gap-2.5 px-2.5 py-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{meeting.title}</span>
          <span className="hidden flex-none text-xs text-ink-subtle sm:inline">{formatDateTime(meeting.startsAt)}</span>
          {meeting.timeRemainingMs > 0 && (
            <span className="hidden flex-none text-xs text-ink-subtle md:inline">{humanizeTimeRemaining(meeting.timeRemainingMs)}</span>
          )}
          <BriefStatusChip status={meeting.briefStatus} />
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" className={`flex-none text-ink-subtle transition-transform ${open ? 'rotate-180' : ''}`}>
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {meeting.hubspotUrl && (
          <a
            href={meeting.hubspotUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open deal in HubSpot"
            aria-label="Open deal in HubSpot"
            className="flex-none rounded-md p-1 text-ink-subtle transition-colors hover:bg-canvas hover:text-accent"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5h6.5V10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12.5 3.5L4 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        )}
      </div>

      {open && (
        <div className="border-t border-line px-2.5 py-2.5">
          {canGenerate && !isGenerating && !brief && (
            <EmptyState
              className="border-0 py-4"
              title="No brief yet"
              description="Generate a pre-call brief for this meeting."
              action={
                <button
                  type="button"
                  onClick={() => void generate()}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-canvas"
                >
                  Generate brief
                </button>
              }
            />
          )}
          {isGenerating && (
            <div className="rounded-md border border-line bg-canvas p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Generating brief…
              </div>
              <div className="mt-3"><SkeletonText lines={3} /></div>
            </div>
          )}
          {!isGenerating && failed && (
            <ErrorState className="border-0 py-4" title="Brief generation failed" onRetry={() => void generate()} />
          )}
          {!isGenerating && !failed && error && (
            <ErrorState className="border-0 py-4" title="Couldn’t load brief" onRetry={() => void generate()} />
          )}
          {!isGenerating && !failed && brief && brief.jobStatus === 'completed' && hasDetail && (
            <BriefDetailView brief={brief} />
          )}
          {!isGenerating && !failed && !error && !brief && !canGenerate && loading && <SkeletonText lines={3} />}
        </div>
      )}
    </div>
  );
}
