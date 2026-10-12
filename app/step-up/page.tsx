import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {StepUpForm} from '@/components/step-up-form';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {isStepUpClass, stepUpReturnPaths} from '@/lib/step-up';
import {beginStepUp} from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.stepUp')};
}

// Where the sensitive areas of later stories send a person who needs a fresh sign-in: /step-up?for=<class>. The
// class is checked against the closed list here (an unknown one is a page that does not exist) and again by the
// action it is bound to when the page renders. The form has no field at all, so nothing a person submits is an
// Account, a session, a return path or a time; only the class, a label from the closed list, comes from the URL.
// Only an active Account with a valid grant sees the page. It tells the person what is being confirmed (the words
// come from the class) and which Google address is signed in, the verified one from Auth (Story 1.11).
export default async function StepUpPage({searchParams}: {searchParams: Promise<{for?: string | string[]}>}) {
  const access = await requireActiveAccount();
  const {for: requested} = await searchParams;
  const actionClass = Array.isArray(requested) ? requested[0] : requested;
  if (!isStepUpClass(actionClass)) notFound();
  // Administration is the Administrator's: for anyone else the page that it returns to answers 404, so the step-up that
  // would lead there is a page that does not exist too (and does not tell a member they are about to change invitation
  // codes). The role is the live authorization's, as for the pages themselves.
  if (actionClass === 'administration' && access.account.role !== 'administrator') notFound();
  return <StepUpForm start={beginStepUp.bind(null, actionClass)} cancelHref={stepUpReturnPaths[actionClass]} actionClass={actionClass} email={access.user.email} />;
}
