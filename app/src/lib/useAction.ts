/**
 * Runs an api call with pending and error state, so a feature never has to
 * hand-roll it — and so every failure reaches the user as a sentence rather
 * than as a silent no-op.
 */

import { useCallback, useState } from 'react'
import { ApiError } from '@/api'

export interface ActionState {
  pending: boolean
  error: string | null
  /** Present when the failure carries the "why this rule exists" line. */
  detail: string | null
}

export function useAction() {
  const [state, setState] = useState<ActionState>({ pending: false, error: null, detail: null })

  const run = useCallback(async (fn: () => Promise<unknown>, onDone?: () => void) => {
    setState({ pending: true, error: null, detail: null })
    try {
      await fn()
      setState({ pending: false, error: null, detail: null })
      onDone?.()
      return true
    } catch (err) {
      const e = err as ApiError
      setState({
        pending: false,
        error: e instanceof ApiError ? e.message : 'Something broke on nova3D’s side.',
        detail: e instanceof ApiError ? e.detail ?? null : null,
      })
      return false
    }
  }, [])

  const clear = useCallback(() => setState({ pending: false, error: null, detail: null }), [])

  return { ...state, run, clear }
}
