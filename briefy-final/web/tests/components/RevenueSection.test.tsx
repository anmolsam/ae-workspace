import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevenueSection } from '../../components/sections/RevenueSection';
import type { BriefDetail } from '../../types/briefy';

function brief(overrides: Partial<BriefDetail>): BriefDetail {
  return {
    id: 'rec1', dealName: '', companyName: '', companyDomain: '', meetingDateTime: 0,
    dealStage: '', dealLink: '', briefStatus: 'Ready',
    sectionStatus: {
      overview: 'ready', portfolio: 'ready', orgTree: 'ready', revenue: 'ready',
      hubspotSignals: 'ready', hiringSignals: 'ready', intent: 'ready',
    },
    overview: '', portfolio: '', orgTree: { estimators: [], programManagers: [], upperManagement: [] },
    zoomInfoRevenue: '', clayRevenue: '', lastPageVisited: '', lastPageVisitedAt: null,
    priorDeals: [], openRoles: [], zoomInfoIntentScore: '',
    ...overrides,
  };
}

describe('RevenueSection', () => {
  it('shows a muted "Clay: pending" note distinctly from a real Clay figure, even while the section itself is ready', () => {
    render(<RevenueSection brief={brief({ zoomInfoRevenue: '$5M-$10M', clayRevenue: 'pending' })} />);
    expect(screen.getByText('$5M-$10M')).toBeTruthy();
    expect(screen.getByText(/Clay: pending/i)).toBeTruthy();
  });

  it('shows the real Clay figure once it has landed', () => {
    render(<RevenueSection brief={brief({ zoomInfoRevenue: '$5M-$10M', clayRevenue: '$7.2M' })} />);
    expect(screen.getByText(/Clay: \$7\.2M/)).toBeTruthy();
  });

  it('shows "not configured" as its own muted note, not as an error', () => {
    render(<RevenueSection brief={brief({ clayRevenue: 'not configured' })} />);
    expect(screen.getByText(/Clay: not configured/i)).toBeTruthy();
  });
});
