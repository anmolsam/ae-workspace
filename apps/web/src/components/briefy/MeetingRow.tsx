import { useState } from 'react';
import type { Meeting } from '../../lib/types';
import { formatDateTime, humanizeTimeRemaining } from '../../lib/format';
import { useBrief } from '../../hooks/useBrief';
import { BriefStatusChip } from './BriefStatusChip';
import { BriefSectionView } from './BriefSectionView';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { SkeletonText } from '../ui/Skeleton';

interface MeetingRowProps {
  meeting: Meeting;
  onGenerated: () => void;
}

export function MeetingRow({ meeting, onGenerated }: MeetingRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { brief, loading, polling, error, generate } = useBrief(
    meeting.id,
    meeting.briefId,
    { onGenerated },
  );

  const canGenerate = meeting.briefStatus === 'needs_generation';
  const isGenerating =
    polling ||
    meeting.briefStatus === 'generating' ||
    brief?.jobStatus === 'queued' ||
    brief?.jobStatus === 'processing';
  const failed = brief?.jobStatus === 'failed';

  const sortedSections = brief
    ? [...brief.sections].sort((a, b) => a.order - b.order)
    : [];

  return (
    <div className="rounded-card border border-line bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-4 p-4 text-left"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-ink">{meeting.title}</span>
            <BriefStatusChip status={meeting.briefStatus} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-subtle">
            {meeting.company && <span className="text-ink-muted">{meeting.company}</span>}
            <span>{formatDateTime(meeting.startsAt)}</span>
            <span>{humanizeTimeRemaining(meeting.timeRemainingMs)}</span>
            <span>
              {meeting.attendees.length}{' '}
              {meeting.attendees.length === 1 ? 'attendee' : 'attendees'}
            </span>
          </div>
        </div>
        <span className="mt-1 flex-none text-ink-subtle">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="animate-fade-in border-t border-line p-4">
          {canGenerate && !isGenerating && !brief && (
            <EmptyState
              className="border-0 py-6"
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
            <div className="rounded-md border border-line bg-canvas p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                Generating brief…
              </div>
              <div className="mt-3">
                <SkeletonText lines={4} />
              </div>
            </div>
          )}

          {!isGenerating && error && (
            <ErrorState
              className="border-0 py-6"
              title="Couldn’t load brief"
              onRetry={() => void generate()}
            />
          )}

          {!isGenerating && failed && (
            <ErrorState
              className="border-0 py-6"
              title="Brief generation failed"
              message="We couldn’t build this brief. Try generating it again."
              onRetry={() => void generate()}
            />
          )}

          {!isGenerating && !failed && brief && brief.jobStatus === 'completed' && (
            <div className="space-y-5">
              {sortedSections.length === 0 && (
                <EmptyState className="border-0 py-6" title="Brief has no content." />
              )}
              {sortedSections.map((section) => (
                <BriefSectionView key={section.key} section={section} />
              ))}
              {brief.sources.length > 0 && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Sources
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {brief.sources.map((s, i) => (
                      <Badge key={`${s.provider}-${i}`} tone="neutral">
                        {s.provider} · {s.kind}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!isGenerating && !failed && !error && !brief && !canGenerate && loading && (
            <SkeletonText lines={4} />
          )}
        </div>
      )}
    </div>
  );
}
