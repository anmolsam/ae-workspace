import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

/** Clay Revenue is a real dollar figure, or one of two literal sentinel strings
 *  the backend writes while the async Clay enrichment is still in flight or unset
 *  (see src/briefy/sections/revenue.js) — never a section-level status by itself. */
function isSentinel(clayRevenue: string) {
  return clayRevenue === 'pending' || clayRevenue === 'not configured';
}

export function RevenueSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Revenue" status={brief.sectionStatus.revenue}>
      <p className="text-sm text-neutral-700">{brief.zoomInfoRevenue || 'Unknown (ZoomInfo)'}</p>
      <p className={`mt-1 text-xs ${isSentinel(brief.clayRevenue) ? 'text-neutral-400' : 'text-neutral-700'}`}>
        Clay: {brief.clayRevenue || 'not configured'}
      </p>
    </SectionPanel>
  );
}
