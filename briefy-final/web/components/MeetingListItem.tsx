import Link from 'next/link';
import type { MeetingSummary } from '../types/briefy';

const STATUS_DOT: Record<MeetingSummary['briefStatus'], string> = {
  'Not Started': 'bg-status-unavailable',
  Generating: 'bg-status-pending',
  Refreshing: 'bg-status-pending',
  Ready: 'bg-status-ready',
  Error: 'bg-status-error',
};

export function MeetingListItem({ meeting }: { meeting: MeetingSummary }) {
  const time = new Date(meeting.meetingDateTime).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Link
      href={`/briefs/${meeting.id}`}
      className="flex items-center justify-between rounded-md border border-neutral-200 px-4 py-3 hover:border-neutral-300 hover:bg-neutral-50"
    >
      <div>
        <p className="font-medium text-neutral-900">{meeting.companyName}</p>
        <p className="text-sm text-neutral-500">
          {meeting.dealName} · {meeting.dealStage}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-neutral-500">{time}</span>
        <span
          className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[meeting.briefStatus]}`}
          title={meeting.briefStatus}
        />
      </div>
    </Link>
  );
}
