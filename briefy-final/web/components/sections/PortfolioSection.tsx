import { SectionPanel } from '../SectionPanel';
import type { BriefDetail } from '../../types/briefy';

export function PortfolioSection({ brief }: { brief: BriefDetail }) {
  return (
    <SectionPanel title="Portfolio / Projects" status={brief.sectionStatus.portfolio}>
      <p className="whitespace-pre-line text-sm text-neutral-700">
        {brief.portfolio || 'No portfolio/project links found on their site.'}
      </p>
    </SectionPanel>
  );
}
