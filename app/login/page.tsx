import type {Metadata} from 'next';
import {LoginForm} from '@/components/login-form';
import {getI18n} from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: t('meta.login')};
}

export default async function LoginPage({searchParams}: {searchParams: Promise<{error?: string | string[]}>}) {
  const params = await searchParams;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  return <LoginForm initialError={error} />;
}
