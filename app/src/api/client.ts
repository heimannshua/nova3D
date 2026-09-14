/**
 * Transport.
 *
 * Every call in `src/api/index.ts` goes through `request()`. Today it runs the
 * in-memory backend behind a short delay; when the real backend lands, this is
 * the single file that changes — `request` becomes `fetch`, and the resource
 * modules and every feature that imports them stay as they are.
 *
 * It also owns the two cross-cutting concerns that a real client owns:
 * connectivity and error shape. Features never construct an ApiError themselves.
 */

import { ApiError } from './types'

/**
 * Forced-offline switch. Real connectivity would come from `navigator.onLine`
 * plus request failures; this is here because half the offline requirements are
 * about what nova3D *says* when it cannot do something (NFR-19), and that has to
 * be demonstrable on demand.
 */
let forcedOffline = false
export const setForcedOffline = (v: boolean) => {
  forcedOffline = v
}
export const isOffline = () => forcedOffline || (typeof navigator !== 'undefined' && navigator.onLine === false)

export interface RequestOptions {
  /**
   * Whether this call needs a connection. Reading, picture conversion,
   * inspection, both approval gates and slicing for a known printer all work
   * offline; research, sending a print, watching and sync do not.
   */
  needsConnection?: boolean
  /** Simulated latency. Remove with the mock backend. */
  delayMs?: number
}

export async function request<T>(fn: () => T, opts: RequestOptions = {}): Promise<T> {
  if (opts.needsConnection && isOffline()) {
    throw new ApiError(
      'This needs an internet connection, and you are offline.',
      'offline',
      'nova3D states what it cannot do rather than failing silently or appearing to succeed.',
    )
  }

  await new Promise((r) => setTimeout(r, opts.delayMs ?? 180))

  try {
    return fn()
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(
      err instanceof Error ? err.message : 'Something broke on nova3D’s side.',
      'server',
    )
  }
}
