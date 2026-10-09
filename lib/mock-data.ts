export type ProjectStatus = 'Researching' | 'Ready for review' | 'Sample draft';

export type MockProject = {
  id: string;
  title: string;
  subtitle: string;
  status: ProjectStatus;
  progress?: number;
  updated: string;
  mode: 'Evidence-backed' | 'Image-derived';
  tone: 'violet' | 'blue' | 'amber';
};

export const mockProjects: MockProject[] = [
  {
    id: 'outer-altar-ramp',
    title: 'Outer Altar and Ramp',
    subtitle: 'Middot 3 · current version 1',
    status: 'Ready for review',
    progress: 78,
    updated: 'Updated today',
    mode: 'Evidence-backed',
    tone: 'violet',
  },
  {
    id: 'garden-arch',
    title: 'Garden arch study',
    subtitle: 'Image-derived · sample draft',
    status: 'Sample draft',
    updated: 'Updated yesterday',
    mode: 'Image-derived',
    tone: 'blue',
  },
  {
    id: 'courtyard-bench',
    title: 'Courtyard bench',
    subtitle: 'Middot 3 · research in progress',
    status: 'Researching',
    progress: 34,
    updated: 'Running now',
    mode: 'Evidence-backed',
    tone: 'amber',
  },
];

// The shell is synthetic: every project below is sample data and nothing is persisted.
export const healthSummary = {
  appMode: 'synthetic-shell',
  providerCall: false,
  authConfigured: false,
  syntheticData: true,
} as const;
