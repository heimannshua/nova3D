import {healthSummary} from '@/lib/mock-data';
import {hasSupabaseConfig} from '@/lib/auth-config';
import {interimAuthEnabled} from '@/lib/interim-auth';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    ok: true,
    service: 'nova3d-web',
    ...healthSummary,
    authConfigured: hasSupabaseConfig(),
    interimGateConfigured: interimAuthEnabled(),
    authGate: true,
    checkedAt: new Date().toISOString(),
  });
}
