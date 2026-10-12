import type {Metadata} from 'next';
import {RecoverForm} from '@/components/recover-form';
import {getI18n} from '@/lib/i18n/server';
import {requestRecovery} from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.recover')};
}

// Administrator recovery (Story 1.6): the request page. It is public on purpose: it exists for the one person who cannot
// sign in. It has one button and no input, so nothing a visitor submits is an address, a recipient or an Account; the
// action it is bound to mails the link to the configured Administrator address and answers only `sent`, `limited` or
// `unavailable`. It reads no session and no database, and shows nothing of any Workspace.
export default function RecoverPage() {
  return <RecoverForm request={requestRecovery}/>;
}
