'use client';

import {useActionState, useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {renameProject} from '@/app/projects/actions';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {
  attemptRename,
  maxTitleLength,
  newCommandId,
  normalizeTitle,
  projectsPath,
  renameIdle,
  titleErrorKeys,
  titleProblem,
  type ProjectRow,
  type RenameState,
} from '@/lib/project-view';
import {Button, LinkButton} from '../ui/button';
import {Dialog} from '../ui/dialog';
import {Notice} from '../ui/states';

type Target = Pick<ProjectRow, 'id' | 'title' | 'revision'>;

/** What an answer other than a rename says inside the dialog, or null for one that needs no message (nothing yet, a rename that happened, a field error). */
function failureKey(state: RenameState): MessageKey | null {
  switch (state.outcome) {
    case 'stale':
      return 'project.rename.stale';
    case 'reused':
      return 'project.rename.reused';
    case 'gone':
      return 'project.rename.gone';
    case 'unavailable':
      return state.unknown ? 'project.rename.unknown' : 'project.rename.unavailable';
    default:
      return null;
  }
}

/**
 * "Rename this project": one field, one Save. The form carries the Project, the revision the person is looking at, a command ID
 * and the new title, and nothing about the Account (the server takes that from the verified session).
 *
 * The command ID is made once for each change asked for: it is the same for as long as the Project, the revision and the title are
 * the same (and again if the title is typed back), so pressing Save again after an answer was lost sends the same command (and the
 * database answers the original receipt if the first one got through), and it is another ID as soon as any of the three differs.
 * While a save is in flight the dialog cannot be closed (Escape, a click outside and Cancel all wait), so its result and any error
 * are not lost; Cancel is aria-disabled then. A title that is blank, too long, contains a control character
 * or is the name it already has is answered here, in the person's language, before anything is sent. A stale answer (the Project was
 * renamed in another window) keeps the dialog open with the current name in words; the page behind it already shows the current
 * name and revision, so saving again is a new, honest attempt.
 */
export function RenameDialog({project, onRenamed, onClose}: {project: Target; onRenamed: (title: string) => void; onClose: () => void}) {
  const {t} = useI18n();
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  // What the field holds. It is controlled: React resets a form's uncontrolled fields when its action settles, which would take a
  // title typed in between with it.
  const [typed, setTyped] = useState(project.title);
  const [local, setLocal] = useState<'same' | ReturnType<typeof titleProblem>>(null);

  // One command ID for each distinct change asked for in this dialog: a function of the Project, the revision and the title, so it
  // is the same for as long as all three are, and the same again if the title is typed back to what it was. (A map, not just the
  // last one: an answer that was lost may have committed, and the retry must carry the very ID that was sent.)
  const signature = `${project.id}|${project.revision}|${normalizeTitle(typed)}`;
  const [commandIds, setCommandIds] = useState(() => new Map([[signature, newCommandId()]]));
  if (!commandIds.has(signature)) setCommandIds(new Map(commandIds).set(signature, newCommandId()));
  const commandId = commandIds.get(signature) ?? '';

  const [state, formAction, pending] = useActionState(async (previous: RenameState, formData: FormData) => {
    try {
      return await attemptRename(renameProject, previous, formData);
    } finally {
      running.current = false;
    }
  }, renameIdle);

  // The parent's callbacks, read when an answer comes and not when they change, so a rename is reported once.
  const callbacks = useRef({onRenamed, onClose});
  useEffect(() => {
    callbacks.current = {onRenamed, onClose};
  });
  useEffect(() => {
    if (state.outcome === 'renamed') {
      callbacks.current.onRenamed(state.title);
      callbacks.current.onClose();
    } else if (state.outcome === 'invalid') {
      input.current?.focus();
    }
  }, [state]);

  const failure = failureKey(state);

  // While a save is in flight nothing closes the dialog: the rename may commit, and the person must see what came of it.
  const busy = () => running.current || pending;
  const close = () => {
    if (!busy()) onClose();
  };

  const problem = pending ? null : (local ?? (state.outcome === 'invalid' ? state.problem : null));
  const problemKey: MessageKey | null =
    problem === null ? null : problem === 'same' ? 'project.rename.error.same' : problem === 'request' ? 'project.rename.error.request' : titleErrorKeys[problem];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (running.current || pending) {
      event.preventDefault();
      return;
    }
    const title = normalizeTitle(typed);
    const found = titleProblem(title) ?? (title === project.title ? 'same' : null);
    if (found) {
      event.preventDefault();
      setLocal(found);
      input.current?.focus();
      return;
    }
    setLocal(null);
    running.current = true;
  };

  return (
    <Dialog title={t('project.rename.title')} description={t('project.rename.body')} eyebrow={t('project.eyebrow')} onClose={close} locked={pending}>
      <form action={formAction} onSubmit={submit} noValidate className="invite-form rename-form">
        <input type="hidden" name="projectId" value={project.id}/>
        <input type="hidden" name="expectedRevision" value={project.revision}/>
        <input type="hidden" name="commandId" value={commandId}/>
        <div className="invite-field">
          <label htmlFor={fieldId} className="auth-label">{t('project.rename.label')}</label>
          <input
            ref={input}
            id={fieldId}
            name="title"
            type="text"
            className="invite-input"
            value={typed}
            data-autofocus=""
            autoComplete="off"
            aria-required="true"
            aria-describedby={problemKey ? `${hintId} ${errorId}` : hintId}
            aria-invalid={problemKey ? true : undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              if (local) setLocal(null);
            }}
          />
          <p id={hintId} className="auth-hint">{t('project.rename.hint', {max: maxTitleLength})}</p>
          {problemKey ? <div className="invite-notice"><Notice id={errorId} tone="danger" role="alert">{t(problemKey, {max: maxTitleLength})}</Notice></div> : null}
        </div>
        {!pending && failure ? (
          <div className="invite-notice">
            <Notice
              tone={state.outcome === 'stale' ? 'warning' : 'danger'}
              role="alert"
              action={state.outcome === 'gone' ? <LinkButton variant="secondary" href={projectsPath}>{t('project.unavailable.action')}</LinkButton> : undefined}
            >
              {t(failure, state.outcome === 'stale' ? {title: state.title} : undefined)}
            </Notice>
          </div>
        ) : null}
        <div className="dialog-actions">
          <Button variant="secondary" aria-disabled={pending ? true : undefined} onClick={close}>{t('confirm.cancel')}</Button>
          <Button variant="primary" type="submit" aria-disabled={pending ? true : undefined}>{t('project.rename.save')}</Button>
        </div>
        <p className="auth-hint auth-status" role="status">{pending ? t('project.rename.pending') : null}</p>
      </form>
    </Dialog>
  );
}
