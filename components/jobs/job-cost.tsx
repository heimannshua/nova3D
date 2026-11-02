'use client';

import {useId} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {amountText, hasCostActivity, type JobCost} from '@/lib/job-view';
import {LtrToken} from '../ui/text-span';

/**
 * What the Job costs, in the Account's own dollars and exactly (microdollars, written by the one formatter, so an amount above zero is never $0.00 and nothing is rounded or
 * hidden): what is held and not yet charged, what was charged, what went back to the allowance, and how many requests may still be charged. A Job that reserved and charged
 * nothing says so in words.
 */
export function JobCostSection({cost}: {cost: JobCost}) {
  const {t} = useI18n();
  const titleId = useId();
  return (
    <section className="section job-section" aria-labelledby={titleId} data-section="cost">
      <h2 id={titleId}>{t('job.cost.title')}</h2>
      {hasCostActivity(cost) ? (
        <dl className="project-facts job-facts">
          <div>
            <dt>{t('job.cost.held')}</dt>
            <dd><LtrToken>{amountText(cost.held)}</LtrToken></dd>
          </div>
          <div>
            <dt>{t('job.cost.settled')}</dt>
            <dd><LtrToken>{amountText(cost.settled)}</LtrToken></dd>
          </div>
          <div>
            <dt>{t('job.cost.released')}</dt>
            <dd><LtrToken>{amountText(cost.released)}</LtrToken></dd>
          </div>
          <div>
            <dt>{t('job.cost.pending')}</dt>
            <dd><LtrToken>{cost.chargeableOperations}</LtrToken></dd>
          </div>
        </dl>
      ) : (
        <p>{t('job.cost.none')}</p>
      )}
      <p className="project-muted">{t('job.cost.note')}</p>
    </section>
  );
}
