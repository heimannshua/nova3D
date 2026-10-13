'use client';

import Link from 'next/link';
import {useI18n} from '@/lib/i18n/react';
import {stageDefinition} from '@/lib/project-stage';
import {formatUpdated, updatedIso, versionWords, type ProjectRow} from '@/lib/project-view';
import {StatusBadge} from '../ui/status-badge';
import {LtrToken} from '../ui/text-span';

/** What a card shows of a Project: the same fields a page has, and no more. */
export type ProjectCardData = Pick<ProjectRow, 'id' | 'title' | 'stage' | 'currentVersion' | 'updatedAt'>;

/**
 * One Project as a card: its Version, its title (a link to its overview when `href` is given, and the whole card is the target of
 * that link), the next thing to do in words, its stage as a word with its own shape, and when it was last updated. The title is the
 * person's own text, in any language, so it is isolated from the text around it. `sample` marks a card of the design kit, which is
 * fed by lib/project-fixtures.ts and stands for no Account's Project.
 */
export function ProjectCard({project, href, headingLevel = 3, sample = false}: {project: ProjectCardData; href?: string; headingLevel?: 2 | 3; sample?: boolean}) {
  const {t} = useI18n();
  const stage = stageDefinition(project.stage);
  const headingId = `project-${project.id}-title`;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const updated = formatUpdated(project.updatedAt);
  return (
    <article className="project-card" aria-labelledby={headingId}>
      <div className={`project-visual visual-${stage.visual}`}>
        <div className="visual-art" aria-hidden="true"><div className="visual-grid"/><div className="shape shape-back"/><div className="shape shape-front"/></div>
        {sample ? <span className="visual-label">{t('sample.label')}</span> : null}
      </div>
      <div className="project-body">
        <p className="eyebrow">{versionWords(t, project.currentVersion)}</p>
        <Heading id={headingId} className="project-title">
          {href ? <Link className="card-link" href={href}><bdi>{project.title}</bdi></Link> : <bdi>{project.title}</bdi>}
        </Heading>
        <p className="project-next">{t(stage.nextAction)}</p>
        <div className="project-footer">
          <StatusBadge tone={stage.tone} icon={stage.icon}>{t(stage.label)}</StatusBadge>
          <span className="updated">
            {t('project.updatedLabel')}{' '}
            {updated ? <LtrToken><time dateTime={updatedIso(project.updatedAt)}>{updated}</time></LtrToken> : '-'}
          </span>
        </div>
      </div>
    </article>
  );
}
