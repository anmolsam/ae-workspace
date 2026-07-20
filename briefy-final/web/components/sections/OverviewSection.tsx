import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function OverviewSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Overview" status={brief.sectionStatus.overview}>
      <p className="whitespace-pre-line text-sm text-neutral-700">{brief.overview || 'No overview found.'}</p>
    </SectionPanel>
  );
}
