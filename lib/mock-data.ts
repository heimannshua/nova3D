export type ProjectStatus = 'Researching' | 'Ready for review' | 'Saved locally';

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
    subtitle: 'Image-derived · local draft',
    status: 'Saved locally',
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

export const healthSummary = {
  appMode: 'mock',
  providerCall: false,
  authConfigured: false,
  syntheticData: true,
} as const;
