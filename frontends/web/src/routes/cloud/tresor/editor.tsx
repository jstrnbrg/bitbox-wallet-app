// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeftDark } from '@/components/icon';
import { View, ViewContent } from '@/components/view/view';
import { useCloud } from '../state/context';
import { docStatus } from './status';
import { RecipientsPanel } from './recipients-panel';
import style from './editor.module.css';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const formatAgo = (timestamp: number, t: TFunction): string => {
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < MINUTE) {
    return t('cloud.tresor.editor.ago.now');
  }
  if (diff < HOUR) {
    const count = Math.floor(diff / MINUTE);
    return t('cloud.tresor.editor.ago.minutes', { count });
  }
  if (diff < DAY) {
    const count = Math.floor(diff / HOUR);
    return t('cloud.tresor.editor.ago.hours', { count });
  }
  if (diff < MONTH) {
    const count = Math.floor(diff / DAY);
    return t('cloud.tresor.editor.ago.days', { count });
  }
  if (diff < YEAR) {
    const count = Math.floor(diff / MONTH);
    return t('cloud.tresor.editor.ago.months', { count });
  }
  const count = Math.floor(diff / YEAR);
  return t('cloud.tresor.editor.ago.years', { count });
};

export const TresorEditor = () => {
  const { t } = useTranslation();
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const { docs, createDoc, updateDoc } = useCloud();

  const isNew = !docId;
  const doc = !isNew ? docs.find(d => d.id === docId) : undefined;

  const [title, setTitle] = useState(doc?.title ?? '');
  const [body, setBody] = useState(doc?.body ?? '');
  // Body is read-only by default on existing docs; new docs start editable.
  const [bodyEditing, setBodyEditing] = useState(isNew);
  const createdIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (bodyEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [bodyEditing]);

  // Keep local state in sync when navigating to a different doc (or to /new).
  useEffect(() => {
    if (doc) {
      setTitle(doc.title);
      setBody(doc.body);
      setBodyEditing(false);
    } else if (isNew && createdIdRef.current === null) {
      setTitle('');
      setBody('');
      setBodyEditing(true);
    }
  }, [doc?.id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isNew && !doc) {
    return (
      <View fullscreen={false}>
        <ViewContent>
          <section className={style.page}>
            <p className={style.missing}>{t('cloud.tresor.editor.missing')}</p>
            <Link to="/cloud/tresor" className={style.backLink}>
              <ChevronLeftDark />
              <span>{t('button.back')}</span>
            </Link>
          </section>
        </ViewContent>
      </View>
    );
  }

  const persist = (nextTitle: string, nextBody: string) => {
    if (isNew) {
      if (createdIdRef.current) {
        updateDoc(createdIdRef.current, { title: nextTitle, body: nextBody });
        return;
      }
      // Only create once the user has typed something.
      if (nextTitle.trim() === '' && nextBody.trim() === '') {
        return;
      }
      const newId = createDoc({ title: nextTitle, body: nextBody });
      createdIdRef.current = newId;
      navigate(`/cloud/tresor/${newId}`, { replace: true });
      return;
    }
    if (doc && (nextTitle !== doc.title || nextBody !== doc.body)) {
      updateDoc(doc.id, { title: nextTitle, body: nextBody });
    }
  };

  const handleTitleBlur = () => persist(title, body);
  const handleBodyBlur = () => {
    persist(title, body);
    if (!isNew) {
      setBodyEditing(false);
    }
  };

  const effectiveDoc = doc ?? (createdIdRef.current
    ? docs.find(d => d.id === createdIdRef.current)
    : undefined);

  const status = effectiveDoc ? docStatus(effectiveDoc) : { kind: 'draft' as const };
  const updatedAt = effectiveDoc?.updatedAt;
  const ago = updatedAt ? formatAgo(updatedAt, t) : '';
  const statusLine = status.kind === 'draft'
    ? (updatedAt ? t('cloud.tresor.editor.draftLastEdited', { ago }) : '')
    : t('cloud.tresor.editor.sealedLastUpdated', { ago });

  return (
    <View fullscreen={false}>
      <ViewContent>
        <section className={style.page}>
          <div className={style.topBar}>
            <Link to="/cloud/tresor" className={style.backButton} aria-label={t('button.back')}>
              <ChevronLeftDark />
            </Link>
          </div>
          <div className={style.layout}>
            <div className={style.editor}>
              <input
                type="text"
                className={style.titleInput}
                placeholder={t('cloud.tresor.editor.titlePlaceholder')}
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                aria-label={t('cloud.tresor.editor.titlePlaceholder')}
              />
              {bodyEditing ? (
                <textarea
                  ref={textareaRef}
                  className={style.bodyInput}
                  placeholder={t('cloud.tresor.editor.bodyPlaceholder')}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  onBlur={handleBodyBlur}
                  aria-label={t('cloud.tresor.editor.bodyPlaceholder')}
                />
              ) : (
                <div
                  className={style.bodyReadOnly}
                  role="article"
                  onClick={() => setBodyEditing(true)}>
                  {body || (
                    <span className={style.bodyEmpty}>
                      {t('cloud.tresor.editor.bodyPlaceholder')}
                    </span>
                  )}
                </div>
              )}
              {statusLine && <p className={style.statusLine}>{statusLine}</p>}
            </div>
            {effectiveDoc ? (
              <RecipientsPanel doc={effectiveDoc} />
            ) : (
              <aside className={style.sidebar}>
                <h2 className={style.sidebarTitle}>{t('cloud.tresor.recipients.title')}</h2>
                <p className={style.sidebarPlaceholder}>{t('cloud.tresor.recipients.placeholder')}</p>
              </aside>
            )}
          </div>
        </section>
      </ViewContent>
    </View>
  );
};
