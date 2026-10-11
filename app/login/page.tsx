import type {Metadata} from 'next';
import {LoginForm} from '@/components/login-form';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.login')};
}

export default async function LoginPage({searchParams}: {searchParams: Promise<{error?: string | string[]; notice?: string | string[]}>}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return <LoginForm initialError={first(params.error)} initialNotice={first(params.notice)} />;
}
