'use client';

import Link from 'next/link';
import {useId, useState} from 'react';
import {useI18n} from '@/lib/i18n/react';
import {nextActionDestination, stageDefinition} from '@/lib/project-stage';
import {formatUpdated, sourcesPath, updatedIso, versionWords, type ProjectRow} from '@/lib/project-view';
import {useAnnounce} from '../ui/announcer';
import {Button, LinkButton} from '../ui/button';
import {Icon} from '../ui/icon';
import {Notice} from '../ui/states';
import {StatusBadge} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';
import {RenameDialog} from './rename-dialog';
import {RequestSection, type RequestSectionData} from './request-section';

/**
 * A Project's overview (H-03): its title, its stage in words and in a shape of its own, its Version, when it was last updated, the
 * next thing to do stated in words (and a link to where it is done, once the story that owns that page has registered one: until
 * then the words stand alone and there is no link to nowhere), and its Model and Sources entries. Rename (H-04) is here.
 *
 * Everything shown is what the Account's own Project row holds. The title is the person's text, in any language, isolated from the
 * text around it.
 */
export function ProjectOverview({project, request = {state: 'none'}}: {project: ProjectRow; request?: RequestSectionData}) {
  const {t, locale} = useI18n();
  const announce = useAnnounce();
  const nextId = useId();
  const [renaming, setRenaming] = useState(false);
  const [renamed, setRenamed] = useState<string | null>(null);
  const stage = stageDefinition(project.stage);
  const destination = nextActionDestination(project.stage, project.id);
  const updated = formatUpdated(project.updatedAt);

  return (
    <div className="page">
      <p className="eyebrow">{t('project.eyebrow')}</p>
      <div className="page-title-row">
        <div className="project-heading">
          <h1 className="project-title"><bdi>{project.title}</bdi></h1>
          <p className="project-stage"><StatusBadge tone={stage.tone} icon={stage.icon}>{t(stage.label)}</StatusBadge></p>
        </div>
        <Button variant="secondary" onClick={() => setRenaming(true)}>{t('project.rename')}</Button>
      </div>
      {renamed ? <div className="invite-notice"><Notice tone="success">{t('project.rename.done', {title: renamed})}</Notice></div> : null}

      <dl className="project-facts">
        <div>
          <dt>{t('project.versionLabel')}</dt>
          <dd>{versionWords(t, project.currentVersion)}</dd>
        </div>
        <div>
          <dt>{t('project.updatedLabel')}</dt>
          <dd>{updated ? <LtrToken><time dateTime={updatedIso(project.updatedAt)}>{updated}</time></LtrToken> : '-'}</dd>
        </div>
      </dl>

      <RequestSection data={request}/>

      <section className="section next-action" aria-labelledby={nextId}>
        <h2 id={nextId}>{t('project.nextTitle')}</h2>
        <p>{t(stage.nextAction)}</p>
        {destination ? (
          <LinkButton variant="primary" href={destination} iconAfter="arrow">{t('project.nextLink')}</LinkButton>
        ) : (
          <p className="project-muted">{t('project.nextNoPage')}</p>
        )}
      </section>

      <ul className="entry-grid">
        <li className="entry-card">
          <span className="action-icon"><Icon name="grid" size={22}/></span>
          <div className="entry-copy">
            <h2>{t('project.model.title')}</h2>
            <p>{project.currentVersion > 0 ? t('project.model.current', {version: project.currentVersion}) : t('project.model.none')}</p>
            <p className="project-muted">{t('project.model.soon')}</p>
          </div>
        </li>
        <li className="entry-card">
          <span className="action-icon"><Icon name="doc" size={22}/></span>
          <div className="entry-copy">
            <h2><Link className="card-link" href={sourcesPath(project.id)}>{t('project.sources.title')}</Link></h2>
            <p>{t('project.sources.body')}</p>
            <span className="action-detail">{t('project.sources.open')}<Icon name="arrow" size={15}/></span>
          </div>
        </li>
      </ul>

      {renaming ? (
        <RenameDialog
          project={project}
          onClose={() => setRenaming(false)}
          onRenamed={(title) => {
            setRenamed(title);
            announce(t('project.rename.done', {title}), locale);
          }}
        />
      ) : null}
    </div>
  );
}
