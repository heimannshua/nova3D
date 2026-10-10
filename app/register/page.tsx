import type {Metadata} from 'next';
import {RegisterForm} from '@/components/register-form';
import {requireUnregisteredIdentity} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';
import {newCommandId} from '@/lib/register';
import {registerWithInvitation, switchGoogleAccount} from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.register')};
}

// Only a signed-in Google identity that has no Account yet sees this page: anyone else is sent where they
// belong (Home for an Account, sign-in for everyone else), by the proxy and again here.
export default async function RegisterPage() {
  const {user} = await requireUnregisteredIdentity();
  // A new command ID for each visit. The form replaces it after every definitive answer.
  return <RegisterForm email={user.email} initialCommandId={newCommandId()} register={registerWithInvitation} switchAccount={switchGoogleAccount}/>;
}
