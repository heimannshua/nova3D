import {NovaDashboard} from '@/components/nova-dashboard';
import {getAccess} from '@/lib/auth';
import {redirect} from 'next/navigation';

export default async function HomePage() {
  const access = await getAccess();
  if (access.kind === 'none') redirect('/login');
  return <NovaDashboard />;
}
