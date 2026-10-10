import type {Metadata} from 'next';
import {SettingsContent} from '@/components/settings/settings-content';
import {requireActiveAccount} from '@/lib/auth';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.settings')};
}

export default async function SettingsPage() {
  await requireActiveAccount();
  return <SettingsContent />;
}
