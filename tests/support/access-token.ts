// An access token as far as the gate reads one: the claims, unsigned. The gate decodes the `sub` and
// `session_id` of a token Auth has just verified and checks nothing else, so the unit tests that stand in for
// Auth need only claims. (The browser tests sign real tokens: see session-cookie.ts.)
export function unsignedToken(claims: Record<string, unknown>) {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  // Valid for an hour unless a test says otherwise (`exp: undefined` leaves the claim out).
  const withExpiry = 'exp' in claims ? claims : {...claims, exp: Math.floor(Date.now() / 1000) + 3600};
  return `${segment({alg: 'HS256', typ: 'JWT'})}.${segment(withExpiry)}.signature`;
}

/** The part of a Supabase client that reads the session, as the gate calls it. */
export function sessionReader(userId: string, sessionId: string | null) {
  return {
    getSession: async () => ({
      data: {session: {access_token: unsignedToken(sessionId ? {sub: userId, session_id: sessionId} : {sub: userId})}},
      error: null,
    }),
  };
}
