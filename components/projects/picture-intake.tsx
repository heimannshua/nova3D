'use client';

import {useActionState, useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent} from 'react';
import {discardPictures, savePictureSet} from '@/app/projects/new/pictures/actions';
import {useI18n} from '@/lib/i18n/react';
import type {MessageKey} from '@/lib/i18n';
import {captureFrame, cameraSupported, openCamera, stopStream, watchTracks, type CameraStream} from '@/lib/picture-camera';
import {holdFiles, releaseUnlessSaved} from '@/lib/picture-fetch';
import {
  acceptAttribute,
  addFiles,
  displayName,
  formatParams,
  discardable,
  formatBytes,
  maxPictureBytes,
  maxPictures,
  maxSetBytes,
  moveItem,
  orderedUploadIds,
  removeItem,
  replaceItem,
  retryItem,
  retryable,
  savedSet,
  settleHash,
  setProblem as setProblemOf,
  totals,
  typeLabel,
  unsavedUploadIds,
  updateItem,
  type FileProblem,
  type ItemMaker,
  type PictureItem,
  type PictureSet,
  type SavedPicture,
  type SetProblem,
} from '@/lib/picture-set';
import {canHash, createUploadQueue, sha256Hex, uploadPicture} from '@/lib/picture-upload';
import {
  attemptDiscard,
  attemptSave,
  browserStorage,
  commandIdFor,
  fileProblemKeys,
  forgetCommandId,
  newCommandId,
  requestKey,
  saveIdle,
  saveKey,
  setProblemKeys,
  settleSave,
  uploadProblemKeys,
  type SaveState,
} from '@/lib/picture-view';
import {formatUpdated, projectPath} from '@/lib/project-view';
import {useAnnounce} from '../ui/announcer';
import {Button, LinkButton} from '../ui/button';
import {Icon} from '../ui/icon';
import {EmptyState, Notice} from '../ui/states';

type CameraPhase = 'off' | 'asking' | 'live';
type CameraNotice = 'denied' | 'failed';
type FileProblems = {name: string; problem: FileProblem}[];

/**
 * Where the screen starts. Only the tests give any of this (as the text flow's `initial` is only the tests'): they render a state the browser would reach,
 * to see a screen without one. A person's screen always starts from the saved set (or from nothing).
 */
export type InitialPictures = {
  set?: PictureSet;
  problems?: FileProblems;
  save?: SaveState;
  camera?: CameraPhase;
  cameraNotice?: CameraNotice | null;
  /** Whether the browser can take photos (otherwise decided after the page is hydrated, from `navigator.mediaDevices`). */
  supported?: boolean;
  /** Whether the page can hash a file (otherwise decided after the page is hydrated: a secure context is required). */
  secure?: boolean;
  /** The set problem shown, as if Save had been pressed. */
  tried?: boolean;
  /** The screen as it is while a Save is out: nothing can be added, moved, replaced or removed. */
  locked?: boolean;
};

const never = () => () => undefined;

/** The text of a file problem, naming the file in the person's language, with the limits through placeholders (no Latin word in the Hebrew catalog). */
function useFileProblemText() {
  const {t} = useI18n();
  return (name: string, problem: FileProblem) =>
    t(fileProblemKeys[problem], {name, ...formatParams, size: formatBytes(problem === 'set_too_large' ? maxSetBytes : maxPictureBytes), count: maxPictures});
}

/**
 * The picture intake screen (Story 2.2, C-03): choose files or take a photo, see the pictures in order, add, replace, move and remove them, and save
 * them privately. Each picture is hashed in the browser and sent, one at a time, straight to the file gateway with a single-use ticket: no picture ever
 * crosses a Vercel function, and nothing here fetches, stores, renders or links a download of a staged picture (a preview is the local object URL of the
 * file the person chose, and goes away when the picture does). Saving records the ordered set as an unconfirmed request revision and goes to the Project:
 * it confirms nothing, starts nothing and costs nothing.
 *
 * Order is changed with real buttons (Move earlier, Move later): no drag and drop. After a step focus goes to where the person is working, or to the first
 * thing to fix, and each change of order and each result is announced through the page's live region.
 *
 * `projectId` is null for a new set (the Project is born at the first Save) and the Project's ID when its saved set is being changed; `revision` is the
 * number of the saved revision, so a Save of the same pictures from an earlier state is a different command. `reviewed` is whether that revision was reviewed (the
 * review is not carried over to a successor: the screen says that saving changes starts it again).
 */
export function PictureIntake({
  projectId = null,
  title,
  revision = null,
  saved = [],
  reviewed = false,
  initial = {},
}: {
  projectId?: string | null;
  title?: string;
  revision?: number | null;
  saved?: SavedPicture[];
  /** Whether the saved revision was reviewed (its pictures carry labels): saving changes then starts the review again, and the screen says so. */
  reviewed?: boolean;
  initial?: InitialPictures;
}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const problemText = useFileProblemText();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const chooseRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const takeRef = useRef<HTMLButtonElement>(null);
  const captureRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const problemsRef = useRef<HTMLDivElement>(null);
  const cameraNoticeRef = useRef<HTMLDivElement>(null);
  const saveNoticeRef = useRef<HTMLDivElement>(null);
  const ids = {
    list: useId(),
    problems: useId(),
    setIssue: useId(),
    saveNote: useId(),
    cameraNotice: useId(),
    help: useId(),
  };

  // The set: its latest value is kept in a ref as well, so an upload that finishes later reads the set as it is then, not as it was when the upload began.
  const [set, setSet] = useState<PictureSet>(() => initial.set ?? savedSet(saved, (picture) => `saved-${picture.uploadId}`));
  const setRef = useRef(set);
  const commit = (next: PictureSet) => {
    setRef.current = next;
    setSet(next);
  };
  const find = (key: string) => setRef.current.find((item) => item.key === key);
  const positionOf = (key: string) => setRef.current.findIndex((item) => item.key === key) + 1;

  const [problems, setProblems] = useState<FileProblems>(initial.problems ?? []);
  const [camera, setCamera] = useState<CameraPhase>(initial.camera ?? 'off');
  const [cameraNotice, setCameraNotice] = useState<CameraNotice | null>(initial.cameraNotice ?? null);
  const [tried, setTried] = useState(initial.tried ?? false);
  // The answer to Save that the person has moved on from (they changed the set after it): it is not shown any more.
  const [dismissed, setDismissed] = useState<SaveState | null>(null);

  // What the browser can do. Decided after hydration (the server does not know), through the store hook so the first render is the server's.
  const cameraHere = useSyncExternalStore(never, () => cameraSupported(), () => false);
  const secureHere = useSyncExternalStore(never, () => canHash(), () => true);
  const supported = initial.supported ?? cameraHere;
  const secure = initial.secure ?? secureHere;

  const counter = useRef(0);
  const mounted = useRef(false);
  const hashQueue = useRef(createUploadQueue());
  const uploadQueue = useRef(createUploadQueue());
  const controllers = useRef(new Map<string, AbortController>());
  const inflight = useRef(new Map<string, string>());
  const previews = useRef(new Set<string>());
  const stream = useRef<CameraStream | null>(null);
  const cameraRun = useRef(0);
  const replacing = useRef<string | null>(null);
  const pendingFocus = useRef<{key: string; action: 'earlier' | 'later' | 'replace' | 'remove' | 'retry'} | null>(null);
  const focusAfter = useRef<'problems' | 'cameraNotice' | 'saveNotice' | 'capture' | 'take' | 'list' | null>(null);
  const saving = useRef(false);
  const lastSent = useRef<{key: string; id: string} | null>(null);
  // The uploads of the Save that is out (or was last sent): never released by this screen, whatever else happens to it.
  const submitted = useRef<string[]>([]);
  // A picture a replacement stands in for, kept aside (by the replacement's key) until the replacement has been read and hashed: if it turns out to be a duplicate
  // or unreadable, the original goes back in its place.
  const held = useRef(new Map<string, PictureItem>());
  const capturing = useRef(false);
  const unwatch = useRef<(() => void) | null>(null);

  const latest = useRef({announce, t, locale});
  useEffect(() => {
    latest.current = {announce, t, locale};
  });
  const say = (key: MessageKey, params?: Record<string, string | number>) => {
    const {announce: speak, t: words, locale: language} = latest.current;
    speak(words(key, params), language);
  };

  /** The uploads this screen staged, that are ready, and that are neither part of a saved revision nor of the Save that was sent: the ones to give back when the screen goes. */
  const unsavedUploads = () => unsavedUploadIds([...setRef.current, ...held.current.values()], submitted.current);
  const discardAll = (uploadIds: string[]) => {
    // The release takes at most 12 at a time.
    for (let from = 0; from < uploadIds.length; from += maxPictures) void attemptDiscard(discardPictures, uploadIds.slice(from, from + maxPictures));
  };

  // The screen going away: nothing keeps uploading, no preview URL outlives it, the camera's light goes out, and what was staged here and never saved is given
  // back (best effort: a closing page cannot be sure the request leaves, and an upload that is not released lapses on its own after 24 hours).
  useEffect(() => {
    mounted.current = true;
    const running = controllers.current;
    const urls = previews.current;
    const leave = () => {
      const ids = unsavedUploads();
      if (ids.length) discardAll(ids);
    };
    // Closing or reloading the tab with unsaved pictures asks first (the browser words the question), unless a Save is on its way.
    const ask = (event: BeforeUnloadEvent) => {
      if (saving.current) return;
      const unsaved = [...setRef.current, ...held.current.values()].some((item) => !item.saved);
      if (!unsaved) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('beforeunload', ask);
      window.removeEventListener('pagehide', leave);
      leave();
      mounted.current = false;
      for (const controller of running.values()) controller.abort();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      unwatch.current?.();
      stopStream(stream.current);
      stream.current = null;
    };
  }, []);

  // Focus moves after the render that made its target (a button that moved, a notice that appeared). Nothing here changes state.
  useEffect(() => {
    const target = pendingFocus.current;
    if (target) {
      pendingFocus.current = null;
      const list = listRef.current;
      const first = list?.querySelector<HTMLButtonElement>(`[data-key="${target.key}"][data-action="${target.action}"]`);
      const other = list?.querySelector<HTMLButtonElement>(`[data-key="${target.key}"][data-action="${target.action === 'earlier' ? 'later' : 'earlier'}"]`);
      (first && !first.disabled ? first : other && !other.disabled ? other : list?.querySelector<HTMLElement>(`[data-key="${target.key}"]`))?.focus();
    }
    const where = focusAfter.current;
    if (where) {
      focusAfter.current = null;
      const element =
        where === 'problems' ? problemsRef.current : where === 'cameraNotice' ? cameraNoticeRef.current : where === 'saveNotice' ? saveNoticeRef.current
        : where === 'capture' ? captureRef.current : where === 'take' ? takeRef.current : listHeadingRef.current;
      element?.focus();
    }
  });

  useEffect(() => {
    const video = videoRef.current;
    if (camera === 'live' && video && stream.current) {
      video.srcObject = stream.current as MediaStream;
      void video.play?.().catch(() => undefined);
    }
  }, [camera]);

  // Previews --------------------------------------------------------------------------------------------------------------------

  const make: ItemMaker = {
    key: () => {
      counter.current += 1;
      return `picture-${counter.current}`;
    },
    preview: (file) => {
      const url = URL.createObjectURL(file);
      previews.current.add(url);
      return url;
    },
  };

  /** A picture leaves the set: its preview URL is revoked, its upload (if it is on its way) is given up, and an upload staged for it and never saved is released at once. */
  const letGo = (item: PictureItem) => {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      previews.current.delete(item.previewUrl);
    }
    controllers.current.get(item.key)?.abort();
    const staged = new Set([discardable(item), item.saved ? null : (inflight.current.get(item.key) ?? null)].filter((id): id is string => id !== null));
    if (staged.size) void attemptDiscard(discardPictures, [...staged]);
  };

  // The pipeline: hash one file at a time, then upload one picture at a time ---------------------------------------------------

  const send = async (key: string) => {
    // A queued upload does not start once the screen has gone.
    if (!mounted.current) return;
    const item = find(key);
    if (!item || !item.file || !item.sha256 || item.state === 'ready') return;
    const controller = new AbortController();
    controllers.current.set(key, controller);
    commit(updateItem(setRef.current, key, {state: 'uploading', progress: 0, problem: null}));
    const outcome = await uploadPicture(
      item.file,
      {sha256: item.sha256, contentType: item.contentType},
      {
        onProgress: (fraction) => {
          if (find(key)) commit(updateItem(setRef.current, key, {progress: fraction}));
        },
        onStart: (uploadId) => inflight.current.set(key, uploadId),
        signal: controller.signal,
      },
    );
    controllers.current.delete(key);
    inflight.current.delete(key);
    // The picture was removed or replaced while it was on its way (or the screen was left): what reached the gateway is released, not kept.
    if (!mounted.current || !find(key)) {
      if (outcome.ok) void attemptDiscard(discardPictures, [outcome.uploadId]);
      return;
    }
    if (outcome.ok) {
      commit(updateItem(setRef.current, key, {state: 'ready', progress: 1, uploadId: outcome.uploadId, problem: null}));
      say('picture.announce.ready', {position: positionOf(key)});
    } else {
      commit(updateItem(setRef.current, key, {state: 'failed', progress: 0, problem: outcome.problem}));
      say('picture.announce.failed', {position: positionOf(key)});
    }
  };

  const process = (key: string) => {
    void hashQueue.current.run(async () => {
      if (!mounted.current) return;
      const item = find(key);
      if (!item?.file || item.state !== 'checking') return;
      if (item.sha256) {
        // A retry: the file was hashed already.
        void uploadQueue.current.run(() => send(key));
        return;
      }
      let outcome: {sha256: string} | {unreadable: true};
      try {
        outcome = {sha256: await sha256Hex(item.file)};
      } catch {
        outcome = {unreadable: true};
      }
      if (!mounted.current || !find(key)) return;
      const original = held.current.get(key);
      const settled = settleHash(setRef.current, key, outcome, original);
      held.current.delete(key);
      commit(settled.set);
      if (settled.removed) {
        // The replacement was refused (the same picture as another, or unreadable): its preview goes, the original it stood in for is back in its place with
        // its upload and its preview, and the problem is told.
        letGo(settled.removed);
        if (settled.problem) {
          setProblems((previous) => [...previous, {name: settled.name ?? '', problem: settled.problem as FileProblem}]);
          say('picture.announce.notAdded', {count: 1});
          focusAfter.current = 'problems';
        }
        return;
      }
      // The replacement is a picture of its own now: the original it replaced is given up.
      if (original) letGo(original);
      void uploadQueue.current.run(() => send(key));
    });
  };

  // Adding, replacing, moving, removing ---------------------------------------------------------------------------------------

  /** The set was changed by the person: what Save said about the set as it was is no longer about it. */
  const touched = () => {
    setTried(false);
    setDismissed(saveState);
  };

  const addChosen = (files: File[], spoken: 'added' | 'captured' = 'added') => {
    // While a Save is out the set is the one that was sent: nothing is added to it.
    if (files.length === 0 || saving.current) return;
    const result = addFiles(setRef.current, files, make);
    commit(result.set);
    setProblems(result.problems);
    touched();
    // One announcement for the whole choice (a second would speak over the first).
    if (result.problems.length) {
      if (result.added.length) say('picture.announce.someAdded', {added: result.added.length, count: result.problems.length});
      else say('picture.announce.notAdded', {count: result.problems.length});
      focusAfter.current = 'problems';
    } else if (result.added.length) {
      if (spoken === 'captured') say('picture.announce.captured', {position: result.set.length});
      else say('picture.announce.added', {count: result.added.length});
    }
    for (const item of result.added) process(item.key);
  };

  const onChoose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    // Reset, so choosing the same file again (after it was removed) is a change the browser reports.
    event.target.value = '';
    addChosen(files);
  };

  const onReplaceChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const key = replacing.current;
    replacing.current = null;
    if (!file || !key || saving.current) return;
    const result = replaceItem(setRef.current, key, file, make);
    if (result.problem) {
      setProblems([{name: displayName(file.name), problem: result.problem}]);
      say('picture.announce.notAdded', {count: 1});
      focusAfter.current = 'problems';
      return;
    }
    if (!result.added || !result.replaced) return;
    commit(result.set);
    setProblems([]);
    touched();
    // The picture being replaced stays (aside, with its upload and its preview) until the replacement has been read and hashed: a replacement that is the same
    // picture as another, or cannot be read, puts it back. One that is not settled itself (it is still being checked or is on its way) is simply given up.
    const carried = held.current.get(key);
    held.current.delete(key);
    if (carried) {
      held.current.set(result.added.key, carried);
      letGo(result.replaced);
    } else if (result.replaced.state === 'ready' || result.replaced.state === 'failed') {
      held.current.set(result.added.key, result.replaced);
    } else {
      letGo(result.replaced);
    }
    say('picture.announce.replacing', {position: positionOf(result.added.key)});
    pendingFocus.current = {key: result.added.key, action: 'replace'};
    process(result.added.key);
  };

  const replace = (key: string) => {
    if (saving.current) return;
    replacing.current = key;
    replaceRef.current?.click();
  };

  const remove = (key: string) => {
    if (saving.current) return;
    const result = removeItem(setRef.current, key);
    if (!result.removed) return;
    commit(result.set);
    touched();
    letGo(result.removed);
    // A picture that was standing in for another one that is being kept aside takes it with it.
    const aside = held.current.get(key);
    held.current.delete(key);
    if (aside) letGo(aside);
    say('picture.announce.removed', {count: result.set.length});
    focusAfter.current = result.set.length ? 'list' : null;
    if (!result.set.length) chooseRef.current?.focus();
  };

  const move = (key: string, direction: 'earlier' | 'later') => {
    if (saving.current) return;
    const next = moveItem(setRef.current, key, direction);
    if (next === setRef.current) return;
    commit(next);
    touched();
    say('picture.announce.moved', {position: positionOf(key), count: next.length});
    pendingFocus.current = {key, action: direction};
  };

  const retry = (key: string) => {
    const item = find(key);
    if (!item || item.state !== 'failed' || !item.file || saving.current) return;
    // After the gateway found that the bytes were not the ones that were hashed (the file changed, or was damaged), the digest that was kept is no longer
    // trusted: the file is read and hashed again before it is sent.
    commit(retryItem(setRef.current, key));
    touched();
    pendingFocus.current = {key, action: 'retry'};
    process(key);
  };

  // The camera ----------------------------------------------------------------------------------------------------------------

  const takePhoto = async () => {
    if (camera !== 'off' || saving.current) return;
    cameraRun.current += 1;
    const run = cameraRun.current;
    setCameraNotice(null);
    setCamera('asking');
    say('picture.announce.cameraAsking');
    // The camera is asked for here, because Take photo was pressed, and nowhere before.
    const result = await openCamera();
    if (!mounted.current || run !== cameraRun.current) {
      if (result.ok) stopStream(result.stream);
      return;
    }
    if (!result.ok) {
      setCamera('off');
      setCameraNotice('denied');
      say('picture.announce.cameraDenied');
      focusAfter.current = 'cameraNotice';
      return;
    }
    stream.current = result.stream;
    // A camera that goes by itself (unplugged, or the permission taken back) closes the preview, and says so.
    unwatch.current = watchTracks(result.stream, () => {
      if (!mounted.current || stream.current !== result.stream) return;
      closeCamera();
      setCameraNotice('failed');
      focusAfter.current = 'cameraNotice';
    });
    setCamera('live');
    say('picture.announce.cameraOn');
    focusAfter.current = 'capture';
  };

  const closeCamera = () => {
    cameraRun.current += 1;
    unwatch.current?.();
    unwatch.current = null;
    stopStream(stream.current);
    stream.current = null;
    setCamera('off');
  };

  const cancelCamera = () => {
    closeCamera();
    say('picture.announce.cameraOff');
    focusAfter.current = 'take';
  };

  const capture = async () => {
    const video = videoRef.current;
    // One frame at a time: a second press while the first is being encoded does nothing.
    if (!video || capturing.current) return;
    capturing.current = true;
    const run = cameraRun.current;
    try {
      const file = await captureFrame(video);
      // The camera was cancelled, closed or lost, or the screen left, while the frame was being made: the frame is dropped.
      if (!mounted.current || run !== cameraRun.current) return;
      if (!file) {
        setCameraNotice('failed');
        focusAfter.current = 'cameraNotice';
        return;
      }
      closeCamera();
      setCameraNotice(null);
      addChosen([file], 'captured');
      focusAfter.current = focusAfter.current ?? 'take';
    } finally {
      capturing.current = false;
    }
  };

  // Saving ----------------------------------------------------------------------------------------------------------------------

  const [saveState, saveForm, savePending] = useActionState(async (previous: SaveState, formData: FormData) => {
    try {
      const result = await attemptSave(savePictureSet, previous, formData);
      // A Save that succeeds goes to the Project and never gets here: an answer that comes back is not a save, so the Files held for the review are let go of.
      releaseUnlessSaved(result.outcome);
      // The answer is read against the uploads that were SUBMITTED (the form's own snapshot), not the live list (lib/picture-view.ts `settleSave`): a command ID
      // the database says was used for something else cannot be used again, and the picture an answer is about is marked.
      const sent = formData.getAll('uploadId').filter((value): value is string => typeof value === 'string');
      const settled = settleSave(result, sent, setRef.current);
      if (settled.forgetCommand) {
        const used = formData.get('commandId');
        forgetCommandId(typeof used === 'string' ? used : '', browserStorage());
        lastSent.current = null;
      }
      if (settled.set !== setRef.current) commit(settled.set);
      // The Save did not leave the screen: its uploads are the person's to change or give up again.
      submitted.current = [];
      if (settled.failed) {
        say('picture.announce.saveFailed');
        focusAfter.current = 'saveNotice';
      }
      return result;
    } finally {
      saving.current = false;
    }
  }, initial.save ?? saveIdle);

  const issue: SetProblem | null = tried ? setProblemOf(set) : null;
  const readyIds = orderedUploadIds(set);

  const submitSave = (event: FormEvent<HTMLFormElement>) => {
    if (saving.current || savePending) {
      event.preventDefault();
      return;
    }
    const problem = setProblemOf(setRef.current);
    setTried(true);
    if (problem) {
      event.preventDefault();
      say('picture.announce.saveFailed');
      focusAfter.current = 'saveNotice';
      return;
    }
    // The command ID is chosen now: the one these pictures were last sent with (a retry after an answer was lost), or a new one. The same pictures saved
    // in another tab a moment ago are the same command. (The form is read after this handler, so the field carries it.)
    const idsNow = orderedUploadIds(setRef.current);
    const key = requestKey([projectId ?? '', String(revision ?? 0), ...idsNow]);
    const proposed = lastSent.current?.key === key ? lastSent.current.id : newCommandId();
    const chosen = commandIdFor(key, proposed, browserStorage());
    const field = event.currentTarget.elements.namedItem('commandId');
    if (field instanceof HTMLInputElement) field.value = chosen;
    lastSent.current = {key, id: chosen};
    submitted.current = idsNow;
    // The review that follows measures these very Files, in this page's memory, and asks the gateway for nothing (after a reload it reads them back instead).
    holdFiles(setRef.current.flatMap((item) => (item.state === 'ready' && item.uploadId && item.file ? [{uploadId: item.uploadId, file: item.file}] : [])));
    saving.current = true;
    say('picture.announce.saving');
  };

  // The screen --------------------------------------------------------------------------------------------------------------------

  const counted = totals(set);
  const failureKey = saveState === dismissed ? null : saveKey(saveState);
  const failurePosition = 'position' in saveState ? saveState.position : 0;
  const failureParams = { position: failurePosition, size: formatBytes(maxSetBytes) };
  const busy = !secure;
  // The set is the one that was sent while a Save is out: nothing can be added to it, moved, replaced or removed.
  const locked = initial.locked ?? savePending;
  const sizeLimits = {count: maxPictures, ...formatParams, size: formatBytes(maxPictureBytes), total: formatBytes(maxSetBytes)};

  return (
    <div className="page page-narrow picture-page">
      <p className="eyebrow">
        {projectId ? t('picture.eyebrow.change') : t('picture.eyebrow.new')}
        {projectId && title ? <> · <bdi>{title}</bdi></> : null}
      </p>
      <h1 ref={headingRef} tabIndex={-1} className="request-title">{projectId ? t('picture.title.change') : t('picture.title.new')}</h1>
      <p className="lede">{t('picture.lede')}</p>
      <p id={ids.help} className="auth-hint">{t('picture.limits', sizeLimits)}</p>
      <p className="auth-hint">{t('picture.privacy')}</p>
      {projectId && reviewed ? (
        <div className="invite-notice">
          <Notice tone="info" role="note">{t('picture.reviewedNote')}</Notice>
        </div>
      ) : null}

      {!secure ? (
        <div className="invite-notice">
          <Notice tone="warning" role="note">
            <strong>{t('picture.secure.title')}</strong> {t('picture.secure.body', {scheme: 'https'})}
          </Notice>
        </div>
      ) : null}

      <div className="picture-controls">
        <label className={`btn btn-secondary picture-choose${busy ? ' picture-choose-disabled' : ''}`}>
          <Icon name="plus" size={17}/>
          <span>{t('picture.choose')}</span>
          <input
            ref={chooseRef}
            type="file"
            className="visually-hidden"
            accept={acceptAttribute}
            multiple
            disabled={busy || locked}
            aria-invalid={problems.length ? true : undefined}
            aria-describedby={[ids.help, problems.length ? ids.problems : null].filter(Boolean).join(' ')}
            onChange={onChoose}
          />
        </label>
        {supported ? (
          <Button ref={takeRef} variant="secondary" icon="image" disabled={busy || locked || camera !== 'off'} onClick={takePhoto}>
            {t('picture.camera.take')}
          </Button>
        ) : null}
        <input ref={replaceRef} type="file" hidden accept={acceptAttribute} onChange={onReplaceChosen}/>
      </div>

      {camera === 'asking' ? (
        <section className="picture-camera" aria-label={t('picture.camera.take')}>
          <Notice tone="info" role="status">{t('picture.camera.asking')}</Notice>
          <div className="request-actions">
            <Button variant="secondary" onClick={cancelCamera}>{t('picture.camera.cancel')}</Button>
          </div>
        </section>
      ) : null}
      {camera === 'live' ? (
        <section className="picture-camera" aria-label={t('picture.camera.take')}>
          <p className="project-muted">{t('picture.camera.live')}</p>
          <video ref={videoRef} className="picture-video" autoPlay playsInline muted aria-label={t('picture.camera.preview')}/>
          <div className="request-actions">
            <Button ref={captureRef} variant="primary" icon="image" onClick={capture}>{t('picture.camera.capture')}</Button>
            <Button variant="secondary" onClick={cancelCamera}>{t('picture.camera.cancel')}</Button>
          </div>
        </section>
      ) : null}
      {cameraNotice ? (
        <div className="invite-notice" ref={cameraNoticeRef} tabIndex={-1} id={ids.cameraNotice}>
          <Notice tone={cameraNotice === 'denied' ? 'warning' : 'danger'} role={cameraNotice === 'denied' ? 'status' : 'alert'}>
            {cameraNotice === 'denied' ? <><strong>{t('picture.camera.deniedTitle')}</strong> {t('picture.camera.denied')}</> : t('picture.camera.failed')}
          </Notice>
        </div>
      ) : null}

      {problems.length ? (
        <div className="invite-notice" ref={problemsRef} tabIndex={-1} id={ids.problems}>
          {/* A Notice holds a paragraph, and a list may not sit in one: the same box, with a block for its words. */}
          <div className="notice notice-danger" role="alert">
            <span className="notice-icon"><Icon name="x-octagon" size={16}/></span>
            <div className="notice-text">
              <strong>{t('picture.problems.title')}</strong>
              <ul className="picture-problems">
                {problems.map((problem, index) => <li key={`${problem.name}-${index}`}>{problemText(problem.name, problem.problem)}</li>)}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <section className="section picture-set" aria-labelledby={ids.list}>
        <h2 id={ids.list} ref={listHeadingRef} tabIndex={-1}>{t('picture.list.title')}</h2>
        {set.length === 0 ? (
          <EmptyState icon="image" headingLevel={3} title={t('picture.empty.title')}>{t('picture.empty.body', {count: maxPictures})}</EmptyState>
        ) : (
          <>
            <p className="project-muted">{t('picture.list.help')}</p>
            <ol className="picture-list" ref={listRef}>
              {set.map((item, index) => (
                <PictureRow
                  key={item.key}
                  item={item}
                  position={index + 1}
                  count={set.length}
                  locked={locked}
                  onMove={move}
                  onReplace={replace}
                  onRemove={remove}
                  onRetry={retry}
                />
              ))}
            </ol>
            <p className="project-muted picture-totals">
              {t('picture.totals', {count: counted.count, max: maxPictures, size: formatBytes(counted.bytes, maxSetBytes), total: formatBytes(maxSetBytes)})}
            </p>
          </>
        )}
      </section>

      <form action={saveForm} onSubmit={submitSave} noValidate className="invite-form request-form picture-save">
        <input type="hidden" name="commandId" defaultValue=""/>
        <input type="hidden" name="projectId" value={projectId ?? ''}/>
        {readyIds.map((id) => <input key={id} type="hidden" name="uploadId" value={id}/>)}
        {failureKey ? (
          <div className="invite-notice" ref={saveNoticeRef} tabIndex={-1} id={ids.setIssue}>
            <Notice tone="danger" role="alert">{t(failureKey, failureParams)}</Notice>
          </div>
        ) : issue ? (
          <div className="invite-notice" ref={saveNoticeRef} tabIndex={-1} id={ids.setIssue}>
            <Notice tone="danger" role="alert">{t(setProblemKeys[issue])}</Notice>
          </div>
        ) : null}
        <p id={ids.saveNote} className="project-muted request-note">{t('picture.save.note')}</p>
        <div className="request-actions">
          <Button
            variant="primary"
            type="submit"
            iconAfter="arrow"
            aria-disabled={savePending ? true : undefined}
            aria-describedby={[ids.saveNote, issue || failureKey ? ids.setIssue : null].filter(Boolean).join(' ')}
          >
            {t('picture.save')}
          </Button>
          {projectId ? <LinkButton variant="quiet" icon="back" href={projectPath(projectId)}>{t('picture.back')}</LinkButton> : null}
        </div>
        <p className="auth-hint auth-status" role="status">{savePending ? t('picture.save.pending') : null}</p>
      </form>
    </div>
  );
}

/** One picture of the set: its preview (if the browser still holds the file), its place, kind and size, how its upload is going, and its four buttons. */
function PictureRow({
  item,
  position,
  count,
  locked,
  onMove,
  onReplace,
  onRemove,
  onRetry,
}: {
  item: PictureItem;
  position: number;
  count: number;
  locked: boolean;
  onMove: (key: string, direction: 'earlier' | 'later') => void;
  onReplace: (key: string) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  const {t} = useI18n();
  const headingId = useId();
  const errorId = useId();
  const expired = item.saved && !item.available;
  const failure = item.state === 'failed' && item.problem ? item.problem : null;
  const expiry = item.expiresAt ? formatUpdated(item.expiresAt) : '';
  const named = (key: MessageKey) => (
    <>
      {t(key)}
      <span className="visually-hidden"> {t('picture.item.picture', {position})}</span>
    </>
  );
  // A move reads "Move picture 2 earlier" to a screen reader (the order of the words is the language's own), and "Move earlier" on the button.
  const moving = (key: MessageKey, spoken: MessageKey) => (
    <>
      <span aria-hidden="true">{t(key)}</span>
      <span className="visually-hidden">{t(spoken, {position})}</span>
    </>
  );
  const percent = Math.round(item.progress * 100);

  return (
    <li className="picture-item" data-key={item.key} tabIndex={-1}>
      <div className="picture-media">
        <div className="picture-thumb">
          {item.previewUrl ? (
            // A local object URL of the file the person chose: next/image cannot optimize it, and nothing here is ever fetched from the server.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.previewUrl} alt={t('picture.item.preview', {position})} decoding="async" loading="lazy"/>
          ) : (
            <span className="picture-thumb-empty"><Icon name="image" size={28}/></span>
          )}
        </div>
        {item.previewUrl ? null : <p className="picture-nopreview project-muted">{t('picture.item.noPreview')}</p>}
      </div>
      <div className="picture-body">
        <h3 id={headingId}>{t('picture.item.title', {position, count})}</h3>
        <p className="picture-details">{t('picture.item.details', {type: typeLabel(item.contentType), size: formatBytes(item.length)})}</p>
        <div className="picture-status">
          {item.state === 'checking' ? <p className="project-muted">{t('picture.item.checking')}</p> : null}
          {item.state === 'uploading' ? (
            <>
              <progress value={percent} max={100} aria-label={t('picture.item.progress', {position})}/>
              <p className="project-muted">{t('picture.item.uploading', {percent})}</p>
            </>
          ) : null}
          {item.state === 'ready' && !expired ? (
            <p className="project-muted">{item.saved && expiry ? t('picture.item.saved', {time: expiry}) : t('picture.item.ready')}</p>
          ) : null}
          {expired ? (
            <div className="picture-note">
              <Notice tone="warning" id={errorId}>{t('picture.item.expired')}</Notice>
            </div>
          ) : null}
          {failure ? (
            <div className="picture-note">
              <Notice tone="danger" role="alert" id={errorId}>{t(uploadProblemKeys[failure], {...formatParams, size: formatBytes(maxPictureBytes)})}</Notice>
            </div>
          ) : null}
        </div>
        <div className="picture-actions">
          <Button variant="secondary" data-key={item.key} data-action="earlier" disabled={locked || position === 1} onClick={() => onMove(item.key, 'earlier')}>{moving('picture.item.earlier', 'picture.item.earlierNamed')}</Button>
          <Button variant="secondary" data-key={item.key} data-action="later" disabled={locked || position === count} onClick={() => onMove(item.key, 'later')}>{moving('picture.item.later', 'picture.item.laterNamed')}</Button>
          <Button variant="secondary" data-key={item.key} data-action="replace" disabled={locked} aria-describedby={failure || expired ? errorId : undefined} onClick={() => onReplace(item.key)}>{named('picture.item.replace')}</Button>
          <Button variant="quiet" data-key={item.key} data-action="remove" disabled={locked} onClick={() => onRemove(item.key)}>{named('picture.item.remove')}</Button>
          {failure && item.file && retryable(failure) ? (
            <Button variant="primary" data-key={item.key} data-action="retry" disabled={locked} aria-describedby={errorId} onClick={() => onRetry(item.key)}>{named('picture.item.retry')}</Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
