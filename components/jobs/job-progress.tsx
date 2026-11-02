'use client';

import {useId} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {progressNoteKey, progressReading, type JobProgress, type JobState} from '@/lib/job-view';

/**
 * How far the work has come (UX-DR40: real progress, never an invented one): requests completed of those planned, as a bar and in words. The bar is for the eye and says the same
 * thing as the words under it (its value text). Work that planned no request has no parts to count (a step exists only once it has begun, so counting steps would always read
 * full): it shows no bar, and the section says so in words, the stage above saying where it is. Before anything has started it says that. A finished Job shows where it stopped.
 */
export function JobProgressSection({progress, state}: {progress: JobProgress; state: JobState}) {
  const {t} = useI18n();
  const titleId = useId();
  const reading = progressReading(progress, state);
  const words = reading ? t(reading.wordsKey, {done: reading.value, total: reading.max}) : null;
  return (
    <section className="section job-section" aria-labelledby={titleId} data-section="progress">
      <h2 id={titleId}>{t('job.progress.title')}</h2>
      {reading ? (
        <div className="job-progress">
          <div
            className="progress-track"
            role="progressbar"
            aria-label={t('job.progress.label')}
            aria-valuemin={0}
            aria-valuemax={reading.max}
            aria-valuenow={reading.value}
            aria-valuetext={words ?? undefined}
          >
            <span className="progress-fill" style={{inlineSize: `${reading.percent}%`}}/>
          </div>
          <strong>{reading.percent}%</strong>
        </div>
      ) : null}
      <p className="job-progress-words">{words ?? t(progressNoteKey(progress, state))}</p>
    </section>
  );
}
