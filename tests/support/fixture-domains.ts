// Story 2.1. A fixture second subject for the several-matches case, and the registry that holds it with Middot's. It lives here and nowhere
// else: the default registry (lib/domain-registry.ts) never holds it, so no page can offer it.
import {createDomainRegistry} from '../../lib/domain-registry';
import {middotManifest} from '../../packages/domains/middot/manifest';
import {fixtureIncenseManifest} from './fixture-manifest';

export {fixtureIncenseManifest};

/** Middot's subject, then the fixture one (registration order). */
export const fixtureRegistry = createDomainRegistry([middotManifest, fixtureIncenseManifest]);
