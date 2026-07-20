import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionPanel } from '../../components/SectionPanel';

describe('SectionPanel', () => {
  it('renders children when ready', () => {
    render(
      <SectionPanel title="Overview" status="ready">
        <p>Real content</p>
      </SectionPanel>
    );
    expect(screen.getByText('Real content')).toBeTruthy();
  });

  it('renders a shimmer placeholder, not children, when pending', () => {
    render(
      <SectionPanel title="Overview" status="pending">
        <p>Real content</p>
      </SectionPanel>
    );
    expect(screen.queryByText('Real content')).toBeNull();
    expect(screen.getByTestId('section-shimmer')).toBeTruthy();
  });

  it('shows the retry-on-refresh message when errored', () => {
    render(
      <SectionPanel title="Overview" status="error">
        <p>Real content</p>
      </SectionPanel>
    );
    expect(screen.getByText(/will retry on the next refresh/i)).toBeTruthy();
  });

  it('shows "Not available" when unavailable', () => {
    render(
      <SectionPanel title="Overview" status="unavailable">
        <p>Real content</p>
      </SectionPanel>
    );
    expect(screen.getByText('Not available')).toBeTruthy();
  });
});
