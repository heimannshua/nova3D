import {healthSummary} from '@/lib/mock-data';
import {hasSupabaseConfig} from '@/lib/auth-config';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    ok: true,
    service: 'nova3d-web',
    ...healthSummary,
    authConfigured: hasSupabaseConfig(),
    authGate: true,
    checkedAt: new Date().toISOString(),
  });
}
