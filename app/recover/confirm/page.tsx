import type {Metadata} from 'next';
import {RecoverConfirmForm} from '@/components/recover-confirm-form';
import {getI18n} from '@/lib/i18n/server';
import {redeemRecovery} from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.recoverConfirm')};
}

// Administrator recovery (Story 1.6): the page the mailed link opens. It is public on purpose, and a GET only renders: the
// link's token is in the URL FRAGMENT, which no server ever receives, so a mail scanner's GET changes nothing and cannot see
// the token. The form moves the token out of the address bar in the browser, and its one button POSTs the Server Action that
// redeems it. This page reads no search parameter, no cookie and no database.
export default function RecoverConfirmPage() {
  return <RecoverConfirmForm redeem={redeemRecovery}/>;
}
