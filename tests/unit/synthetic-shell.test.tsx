import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {NovaDashboard} from '@/components/nova-dashboard';
import {healthSummary, mockProjects} from '@/lib/mock-data';

// AC-3: the shell is labelled synthetic and makes no claim that anything is persisted.
const views = {
  home: <NovaDashboard />,
  projects: <NovaDashboard initialView="projects" />,
  progress: <NovaDashboard initialView="progress" />,
  'create panel': <NovaDashboard initialCreateOpen />,
  'notifications popover': <NovaDashboard initialNoticeOpen />,
};

// Persistence wording, including its negations: the shell should not talk about storage at all.
const persistence = /\bsav(?:e|es|ed|ing)\b|\bstor(?:e|es|ed|ing|age)\b|persist|preserv|local draft|on this device|private collection|offline/i;

describe.each(Object.entries(views))('synthetic shell: %s', (_name, element) => {
  const markup = renderToStaticMarkup(element);

  it('is labelled synthetic', () => {
    expect(markup).toContain('Synthetic shell');
    expect(markup).toContain('role="note"');
    expect(markup).toContain('Sample data only');
  });

  it('no longer calls itself mock mode', () => {
    expect(markup).not.toMatch(/mock mode/i);
  });

  it('makes no persistence claim, not even a negated one', () => {
    expect(markup).not.toMatch(persistence);
  });
});

describe('synthetic shell data', () => {
  it('has no "Saved locally" status or LOCAL card label', () => {
    expect(JSON.stringify(mockProjects)).not.toMatch(/saved|local/i);
    for (const element of Object.values(views)) expect(renderToStaticMarkup(element)).not.toMatch(/saved locally|>LOCAL</i);
  });

  it('labels sample projects as samples', () => {
    const markup = renderToStaticMarkup(<NovaDashboard initialView="projects" />);
    expect(markup).toContain('Sample draft');
    expect(markup).toContain('>SAMPLE<');
  });

  it('reports the same mode through the health summary', () => {
    expect(healthSummary.appMode).toBe('synthetic-shell');
    expect(healthSummary.syntheticData).toBe(true);
    expect(healthSummary.providerCall).toBe(false);
    expect(mockProjects.length).toBeGreaterThan(0);
  });
});
