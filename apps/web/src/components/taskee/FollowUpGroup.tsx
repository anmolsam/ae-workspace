import type { FollowUp } from '../../lib/types';
import { FollowUpCard } from './FollowUpCard';

interface FollowUpGroupProps {
  title: string;
  items: FollowUp[];
  pendingIds: Set<string>;
  onCheck: (fu: FollowUp) => void;
  onUncheck: (fu: FollowUp) => void;
  danger?: boolean;
}

export function FollowUpGroup({
  title,
  items,
  pendingIds,
  onCheck,
  onUncheck,
  danger,
}: FollowUpGroupProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3
          className={`text-xs font-semibold uppercase tracking-wide ${
            danger ? 'text-danger' : 'text-ink-subtle'
          }`}
        >
          {title}
        </h3>
        <span className="rounded-full bg-canvas px-1.5 text-xs font-medium tabular-nums text-ink-subtle">
          {items.length}
        </span>
      </div>
      <div className="space-y-2.5">
        {items.map((fu) => (
          <FollowUpCard
            key={fu.id}
            followUp={fu}
            pending={pendingIds.has(fu.id)}
            onCheck={onCheck}
            onUncheck={onUncheck}
          />
        ))}
      </div>
    </div>
  );
}
