import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {SettingsContent} from '@/components/settings/settings-content';
import {getAccess} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.settings')};
}

export default async function SettingsPage() {
  const access = await getAccess();
  if (access.kind === 'none') redirect('/login');
  return <SettingsContent />;
}
