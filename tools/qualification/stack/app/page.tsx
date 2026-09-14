import {createClient as createSupabaseClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {Redis} from '@upstash/redis';
import {serve as serveWorkflow} from '@upstash/workflow/nextjs';

const importedBindings = {
  supabase: typeof createSupabaseClient,
  ssr: typeof createServerClient,
  redis: typeof Redis,
  workflow: typeof serveWorkflow,
};

export default function Page() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold">nova3D stack probe</h1>
      <p data-stack-probe="ready">Framework imports loaded without provider calls.</p>
      <pre>{JSON.stringify(importedBindings)}</pre>
    </main>
  );
}
