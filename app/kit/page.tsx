import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {KitContent} from '@/components/kit/kit-content';
import {getI18n} from '@/lib/i18n/server';
import {isSyntheticDataEnabled} from '@/lib/public-paths';

// The design kit exists so tests can exercise the shell, tokens and patterns without signing in (the real
// shell is behind sign-in and Story 1.4 supplies no test login). It is public only when SYNTHETIC_DATA_ENABLED
// is true, and production cannot enable synthetic data (check-env). Otherwise proxy.ts treats it like any
// private page: a signed-out visitor is redirected to sign-in, and a signed-in one reaches this page, which
// answers 404.
export async function generateMetadata(): Promise<Metadata> {
  const {t} = await getI18n();
  return {title: isSyntheticDataEnabled(process.env) ? t('meta.kit') : t('meta.notFound')};
}

export default function KitPage() {
  if (!isSyntheticDataEnabled(process.env)) notFound();
  return <KitContent />;
}
