// Story 2.1. The fixture second subject's manifest, apart from the registry that holds it, so a test that replaces the default registry
// can load it without importing the module it replaces. It lives in tests/support/ and nowhere else: no production file registers it.
import type {DomainManifest} from '../../packages/contracts/domain-manifest';

/** "altar" is an alias of this subject too, so a description with "altar" matches two subjects. */
export const fixtureIncenseManifest: DomainManifest = {
  packageId: 'fixture-incense',
  version: 1,
  subjects: [{id: 'fixture-incense-altar', displayName: 'The incense altar (fixture)', aliases: ['altar', 'incense']}],
};
