import {healthSummary} from '@/lib/mock-data';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    ok: true,
    service: 'nova3d-web',
    ...healthSummary,
    checkedAt: new Date().toISOString(),
  });
}
