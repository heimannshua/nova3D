import {cookies} from 'next/headers';
import {allowedEmail, hasSupabaseConfig} from '@/lib/auth-config';
import {interimSessionCookie, verifyInterimSession} from '@/lib/interim-auth';
import {createSupabaseServerClient} from '@/lib/supabase/server';

export async function getAccess() {
  const cookieStore = await cookies();
  if (verifyInterimSession(cookieStore.get(interimSessionCookie)?.value)) {
    return {kind: 'interim' as const, email: null};
  }

  if (hasSupabaseConfig()) {
    const supabase = await createSupabaseServerClient();
    const {data: {user}} = supabase ? await supabase.auth.getUser() : {data: {user: null}};
    if (user && allowedEmail(user.email)) return {kind: 'google' as const, email: user.email ?? null};
  }

  return {kind: 'none' as const, email: null};
}
