'use client';

import {useState, type ReactNode} from 'react';
import {isolateLtr, translate, type MessageKey} from '@/lib/i18n';
import {mockProjects} from '@/lib/mock-data';
import {useI18n} from '@/lib/i18n/react';
import {PreferencesForm} from '../settings/preferences-form';
import {ProjectCard} from '../nova-dashboard';
import {useAnnounce} from '../ui/announcer';
import {Button, LinkButton} from '../ui/button';
import {ConfirmDialog} from '../ui/dialog';
import {GuidanceCard} from '../ui/guidance-card';
import {EmptyState, ErrorState, Notice} from '../ui/states';
import {StatusBadge, type StatusTone} from '../ui/status-badge';
import {LtrToken, TextSpan} from '../ui/text-span';

const statusTones: {tone: StatusTone; label: MessageKey}[] = [
  {tone: 'success', label: 'status.done'},
  {tone: 'warning', label: 'status.warning'},
  {tone: 'danger', label: 'status.failed'},
  {tone: 'info', label: 'status.info'},
  {tone: 'neutral', label: 'status.waiting'},
  {tone: 'running', label: 'status.running'},
];

const evidenceTones: {tone: StatusTone; label: MessageKey}[] = [
  {tone: 'sourced', label: 'evidence.sourced'},
  {tone: 'inferred', label: 'evidence.inferred'},
  {tone: 'disputed', label: 'evidence.disputed'},
  {tone: 'unknown', label: 'evidence.unknown'},
  {tone: 'user-added', label: 'evidence.userAdded'},
];

// Token names are code identifiers, not copy, so they are shown as they are written in globals.css.
const swatches: {group: MessageKey; items: {name: string; background: string; color: string}[]}[] = [
  {group: 'kit.tokens.surface', items: [
    {name: '--surface-page', background: '--surface-page', color: '--text'},
    {name: '--surface-card', background: '--surface-card', color: '--text'},
    {name: '--surface-sunken', background: '--surface-sunken', color: '--text'},
    {name: '--surface-raised', background: '--surface-raised', color: '--text'},
  ]},
  {group: 'kit.tokens.action', items: [
    {name: '--action', background: '--action', color: '--action-text'},
    {name: '--action-soft', background: '--action-soft', color: '--action-soft-text'},
  ]},
  {group: 'kit.tokens.text', items: [
    {name: '--text-strong', background: '--surface-card', color: '--text-strong'},
    {name: '--text-muted', background: '--surface-card', color: '--text-muted'},
    {name: '--text-accent', background: '--surface-card', color: '--text-accent'},
  ]},
];

function Section({title, help, children}: {title: string; help?: string; children: ReactNode}) {
  return (
    <section className="section kit-section">
      <h2>{title}</h2>
      {help ? <p className="settings-help">{help}</p> : null}
      {children}
    </section>
  );
}

/** Synthetic-only page showing every token, shared component and state, plus a bilingual sample (UX-DR20). */
export function KitContent() {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="page">
      <p className="eyebrow">{t('shell.syntheticBadge')}</p>
      <h1>{t('kit.title')}</h1>
      <p className="lede">{t('kit.lede')}</p>

      <Section title={t('kit.buttons.title')}>
        <div className="kit-row">
          <Button variant="primary">{t('kit.buttons.primary')}</Button>
          <Button variant="secondary">{t('kit.buttons.secondary')}</Button>
          <Button variant="quiet">{t('kit.buttons.quiet')}</Button>
          <Button variant="danger">{t('kit.buttons.danger')}</Button>
          <Button variant="secondary" disabled>{t('kit.buttons.disabled')}</Button>
          <LinkButton variant="secondary" href="/" iconAfter="arrow">{t('nav.home')}</LinkButton>
        </div>
      </Section>

      <Section title={t('kit.status.title')} help={t('kit.status.help')}>
        <ul className="kit-row kit-badges">
          {statusTones.map(({tone, label}) => <li key={tone}><StatusBadge tone={tone}>{t(label)}</StatusBadge></li>)}
        </ul>
        <ul className="kit-row kit-badges">
          {evidenceTones.map(({tone, label}) => <li key={tone}><StatusBadge tone={tone}>{t(label)}</StatusBadge></li>)}
        </ul>
      </Section>

      <Section title={t('kit.tokens.title')}>
        {swatches.map((group) => (
          <div key={group.group} className="swatch-group">
            <h3>{t(group.group)}</h3>
            <ul className="swatch-grid">
              {group.items.map((item) => (
                <li key={item.name} className="swatch" style={{background: `var(${item.background})`, color: `var(${item.color})`}}>
                  <LtrToken><code>{item.name}</code></LtrToken>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      <Section title={t('kit.cards.title')}>
        <ul className="card-grid">
          <li><ProjectCard project={mockProjects[0]} href="/projects"/></li>
          <li><ProjectCard project={mockProjects[1]}/></li>
        </ul>
      </Section>

      <Section title={t('kit.states.title')}>
        <div className="kit-states">
          <EmptyState headingLevel={3} title={t('state.emptyTitle')}>{t('state.emptyBody')}</EmptyState>
          <ErrorState headingLevel={3} title={t('state.errorTitle')} action={<Button variant="secondary">{t('state.retry')}</Button>}>{t('state.errorBody')}</ErrorState>
        </div>
        <div className="kit-notices">
          <Notice tone="info">{t('status.info')}</Notice>
          <Notice tone="success">{t('status.done')}</Notice>
          <Notice tone="warning">{t('status.warning')}</Notice>
          <Notice tone="danger">{t('status.failed')}</Notice>
        </div>
        <div className="kit-row">
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>{t('confirm.open')}</Button>
          <Button variant="secondary" onClick={() => announce(t('kit.states.announceMessage'), locale)}>{t('kit.states.announceButton')}</Button>
        </div>
        {confirmOpen ? (
          <ConfirmDialog
            tone="danger"
            title={t('confirm.title')}
            description={t('confirm.body')}
            confirmLabel={t('confirm.confirm')}
            onConfirm={() => setConfirmOpen(false)}
            onCancel={() => setConfirmOpen(false)}
          />
        ) : null}
        <GuidanceCard/>
      </Section>

      <Section title={t('kit.bilingual.title')}>
        <div className="bilingual" data-sample="">
          <p className="eyebrow">{t('kit.bilingual.label')}</p>
          <div className="bilingual-block">
            <h3>{t('kit.bilingual.original')}</h3>
            <TextSpan as="p" lang="he">{translate('he', 'kit.bilingual.label')}</TextSpan>
          </div>
          <div className="bilingual-block">
            <h3>{t('kit.bilingual.translation')}</h3>
            <TextSpan as="p" lang="en">{translate('en', 'kit.bilingual.label')}</TextSpan>
          </div>
          <div className="bilingual-block">
            <h3>{t('kit.bilingual.explanation')}</h3>
            <p>{t('kit.bilingual.explanationBody', {id: isolateLtr('SAMPLE-001'), file: isolateLtr('model-sample.stl')})}</p>
          </div>
        </div>
      </Section>

      <Section title={t('settings.title')}>
        <PreferencesForm/>
      </Section>
    </div>
  );
}
