// Story 2.1. The Middot domain package's manifest: the one registered subject. Erasable syntax and a type-only import, like the contract.
//
// The alias list is NOT approved yet. Josh approves it with the G-1 corpus; the approval is recorded in docs/domain-packages.md and in
// _bmad-output/implementation-artifacts/deferred-work.md, and no code gates on it. A later story adds subjects here (and fields to the
// contract) as they land; an alias another subject also uses is allowed, and a description that matches both asks the person which.
import type {DomainManifest} from '../../contracts/domain-manifest.ts';

export const middotManifest: DomainManifest = {
  packageId: 'middot',
  version: 1,
  subjects: [
    {
      id: 'middot-altar-ramp',
      displayName: 'The outer altar and ramp (Middot 3)',
      aliases: ['altar', 'ramp', 'mizbeach', 'kevesh', 'מזבח', 'כבש'],
    },
  ],
};
