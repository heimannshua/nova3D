import {NovaDashboard} from '@/components/nova-dashboard';
import {requireActiveAccount} from '@/lib/auth';

export default async function HomePage() {
  await requireActiveAccount();
  return <NovaDashboard view="home" />;
}
