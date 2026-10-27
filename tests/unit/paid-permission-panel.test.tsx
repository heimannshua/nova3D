import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {PaidPermissionPanel} from '@/components/projects/paid-permission-panel';

describe('paid permission panel', () => {
  it('shows a specific disabled reason and does not claim permission was granted', () => {
    const html = renderToStaticMarkup(<PaidPermissionPanel provider="Anthropic" purpose="Evidence synthesis" data={['approved project evidence']}
      retention="Terms are not verified." maximum="No verified calculator quote." disabledReason="No verified rate schedule."/>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('No verified rate schedule.');
    expect(html).toContain('Provider</dt><dd>Anthropic');
    expect(html).toContain('Purpose</dt><dd>Evidence synthesis');
    expect(html).toContain('Data sent</dt><dd>approved project evidence');
    expect(html).toContain('Retention and deletion</dt><dd>Terms are not verified.');
    // On purpose changed (Story 2.5): the disclosed maximum bounds one request (each operation), not the Job, so the label says so.
    expect(html).toContain('Highest charge for one request</dt><dd>No verified calculator quote.');
    expect(html).toContain('Permission is off until you grant it.');
    expect(html).toContain('Grant permission');
    expect(html).not.toContain('Revoke permission');
  });
});
