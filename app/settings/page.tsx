import type {Metadata} from 'next';
import {SettingsContent} from '@/components/settings/settings-content';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.settings')};
}

export default async function SettingsPage() {
  const access = await requireActiveAccount();
  // The role is the live authorization's. It only decides whether the link to the Administrator's pages is shown.
  return <SettingsContent isAdministrator={access.account.role === 'administrator'} />;
}
