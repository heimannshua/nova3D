'use client';

import {useI18n} from '@/lib/i18n/react';
import {isolateLtr} from '@/lib/i18n';
import {formatDollars, meterOf, type UsageFigures} from '@/lib/usage-view';

/**
 * How much of the monthly limit is used (Story 2.4). Settled is a solid bar and reserved a striped one, so the two differ by shape and not only by colour, and the
 * colour of both follows the state of the limit (the card sets it). The bar is decoration: its text equivalent is the sentence under it, which is also the meter's
 * value text, and says the same thing as the amounts on the card: what is used of the limit, and how it divides. Over the limit it says by how much.
 */
export function UsageMeter({figures, name}: {figures: UsageFigures; name: string}) {
  const {t} = useI18n();
  const meter = meterOf(figures);
  const text =
    figures.over > 0
      ? t('usage.meter.over', {used: isolateLtr(formatDollars(figures.used)), limit: isolateLtr(formatDollars(figures.limit)), over: isolateLtr(formatDollars(figures.over))})
      : t('usage.meter.text', {
          used: isolateLtr(formatDollars(figures.used)),
          limit: isolateLtr(formatDollars(figures.limit)),
          settled: isolateLtr(formatDollars(figures.settled)),
          reserved: isolateLtr(formatDollars(figures.reserved)),
          available: isolateLtr(formatDollars(figures.available)),
        });
  return (
    <div className="usage-meter">
      <div
        className="usage-meter-track"
        role="meter"
        aria-label={t('usage.meter.label', {name})}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.usedPercent}
        aria-valuetext={text}
      >
        <span className="usage-meter-settled" style={{inlineSize: `${meter.settledPercent}%`}}/>
        <span className="usage-meter-reserved" style={{inlineSize: `${meter.reservedPercent}%`}}/>
      </div>
      <p className="usage-meter-text">{text}</p>
    </div>
  );
}
