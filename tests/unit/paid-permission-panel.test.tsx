import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {PaidPermissionPanel} from '@/components/projects/paid-permission-panel';

describe('paid permission panel', () => {
  it('shows a specific disabled reason and does not claim permission was granted', () => {
    const html = renderToStaticMarkup(<PaidPermissionPanel provider="Anthropic" purpose="Evidence synthesis" data={['approved project evidence']}
      retention="Terms are not verified." maximum="No verified calculator quote." disabledReason="No verified rate schedule."/>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('No verified rate schedule.');
    expect(html).not.toContain('Revoke permission');
  });
});
