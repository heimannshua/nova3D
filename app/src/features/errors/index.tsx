import { Link, useRouteError } from 'react-router-dom'
import { Notice } from '@/components/ui/primitives'

export function NotFound() {
  return (
    <div className="page page-wide">
      <h1 className="page-title">There is nothing here</h1>
      <Notice title="What this means">
        <p style={{ margin: '0 0 var(--space-2)' }}>
          This address does not point at anything in your Workspace. It may have been deleted, or the
          link may be wrong.
        </p>
        <Link to="/projects" className="btn btn-secondary">
          Go to My Projects
        </Link>
      </Notice>
    </div>
  )
}

export function Forbidden() {
  return (
    <div className="page page-wide">
      <h1 className="page-title">You cannot open this</h1>
      <Notice title="What this means">
        <p style={{ margin: '0 0 var(--space-2)' }}>
          This belongs to a different Account. Workspaces are private and nova3D will not show you
          what is in one you do not own — including whether it exists.
        </p>
        <Link to="/" className="btn btn-secondary">
          Go to Home
        </Link>
      </Notice>
    </div>
  )
}

/** Router error boundary. Answers the same six questions every failure answers. */
export function AppError() {
  const error = useRouteError() as Error | undefined
  return (
    <div className="page page-wide">
      <h1 className="page-title">Something broke on nova3D&rsquo;s side</h1>
      <Notice tone="warn" glyph="▲">
        <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
          <li>What failed: loading this screen.</li>
          <li>What was preserved: everything. No Project, Version or approval is affected.</li>
          <li>What is still running: any Job you had started is still running.</li>
          <li>Cost: nothing was charged.</li>
          <li>Needs re-approval: nothing.</li>
          <li>Will it retry: no. Reloading is your decision.</li>
        </ul>
      </Notice>
      {error?.message && (
        <details className="sm muted">
          <summary>Technical detail</summary>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
        </details>
      )}
      <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => location.reload()}>
        Reload this screen
      </button>
    </div>
  )
}
