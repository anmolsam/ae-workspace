import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BriefDetailClient } from '../../components/BriefDetailClient';
import type { BriefDetail } from '../../types/briefy';

function brief(overrides: Partial<BriefDetail>): BriefDetail {
  return {
    id: 'rec1', dealName: 'Acme deal', companyName: 'Acme', companyDomain: 'acme.com',
    meetingDateTime: Date.now(), dealStage: '', dealLink: '', briefStatus: 'Generating',
    sectionStatus: {
      overview: 'pending', portfolio: 'pending', orgTree: 'pending', revenue: 'pending',
      hubspotSignals: 'pending', hiringSignals: 'pending', intent: 'pending',
    },
    overview: '', portfolio: '', orgTree: { estimators: [], programManagers: [], upperManagement: [] },
    zoomInfoRevenue: '', clayRevenue: '', lastPageVisited: '', lastPageVisitedAt: null,
    priorDeals: [], openRoles: [], zoomInfoIntentScore: '',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('BriefDetailClient', () => {
  it('polls GET /api/briefs/:id while Generating and swaps in the ready data', async () => {
    const ready = brief({
      briefStatus: 'Ready',
      overview: 'Acme makes widgets.',
      sectionStatus: {
        overview: 'ready', portfolio: 'ready', orgTree: 'ready', revenue: 'ready',
        hubspotSignals: 'ready', hiringSignals: 'ready', intent: 'ready',
      },
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ready });

    render(<BriefDetailClient initialBrief={brief({})} />);

    expect(screen.getByText('Generating…')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('Acme makes widgets.')).toBeTruthy(), { timeout: 3000 });
    expect(global.fetch).toHaveBeenCalledWith('/api/briefs/rec1');
  });

  it('stops polling once the brief reaches Ready', async () => {
    const ready = brief({ briefStatus: 'Ready' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ready });
    global.fetch = fetchMock;

    render(<BriefDetailClient initialBrief={brief({})} />);
    await waitFor(() => expect(screen.queryByText('Generating…')).toBeNull());

    const callsAtReady = fetchMock.mock.calls.length;
    await new Promise(r => setTimeout(r, 200));
    expect(fetchMock.mock.calls.length).toBe(callsAtReady);
  });
});
