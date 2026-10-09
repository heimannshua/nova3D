import type {MessageKey} from './i18n';

export type ProjectStatus = 'researching' | 'ready-for-review' | 'sample-draft';
export type ProjectMode = 'evidence-backed' | 'image-derived';

// Everything a person can read about a sample project is a catalog key, so the sample reads in the
// interface language. The ids, numbers and tones are plain data.
export type MockProject = {
  id: string;
  title: MessageKey;
  subtitle: MessageKey;
  status: ProjectStatus;
  progress?: number;
  updated: MessageKey;
  mode: ProjectMode;
  tone: 'violet' | 'blue' | 'amber';
};

export const mockProjects: MockProject[] = [
  {
    id: 'outer-altar-ramp',
    title: 'sample.outerAltar.title',
    subtitle: 'sample.outerAltar.subtitle',
    status: 'ready-for-review',
    progress: 78,
    updated: 'sample.outerAltar.updated',
    mode: 'evidence-backed',
    tone: 'violet',
  },
  {
    id: 'garden-arch',
    title: 'sample.gardenArch.title',
    subtitle: 'sample.gardenArch.subtitle',
    status: 'sample-draft',
    updated: 'sample.gardenArch.updated',
    mode: 'image-derived',
    tone: 'blue',
  },
  {
    id: 'courtyard-bench',
    title: 'sample.courtyardBench.title',
    subtitle: 'sample.courtyardBench.subtitle',
    status: 'researching',
    progress: 34,
    updated: 'sample.courtyardBench.updated',
    mode: 'evidence-backed',
    tone: 'amber',
  },
];

export function sampleProjectById(id: string): MockProject {
  const project = mockProjects.find((candidate) => candidate.id === id);
  if (!project) throw new Error(`Unknown sample project: ${id}`);
  return project;
}

// The shell is synthetic: this stands in for the signed-in Account until Story 1.4. Nothing is persisted.
export const sampleAccount = {name: 'Josh', initial: 'J'} as const;

// The shell is synthetic: every project below is sample data and nothing is persisted.
export const healthSummary = {
  appMode: 'synthetic-shell',
  providerCall: false,
  authConfigured: false,
  syntheticData: true,
} as const;
