import { Badge } from '../ui/Badge';
import type { BriefStatus } from '../../lib/types';

const MAP: Record<BriefStatus, { label: string; tone: 'neutral' | 'accent' | 'success' | 'warn' }> = {
  ready: { label: 'Ready', tone: 'success' },
  generating: { label: 'Generating', tone: 'accent' },
  needs_data: { label: 'Needs Data', tone: 'warn' },
  needs_generation: { label: 'Needs brief', tone: 'neutral' },
  completed: { label: 'Meeting Completed', tone: 'neutral' },
};

export function BriefStatusChip({ status }: { status: BriefStatus }) {
  const cfg = MAP[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}
