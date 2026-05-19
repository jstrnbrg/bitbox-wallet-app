// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { View, ViewContent } from '@/components/view/view';
import { ButtonLink } from '@/components/forms/button';
import { ChevronLeftDark } from '@/components/icon';
import { SearchInput } from '@/components/forms/search-input';
import { useCloud } from '../state/context';
import { docStatus, type DocStatus } from './status';
import { RecipientRowPreview } from './recipient-row-preview';
import type { Contact, TresorDoc } from '../state/types';
import style from './list.module.css';

const filterDocs = (docs: TresorDoc[], contacts: Contact[], query: string): TresorDoc[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return docs;
  }
  const contactById = new Map(contacts.map(c => [c.id, c]));
  return docs.filter(doc => {
    const recipientMatches = doc.recipients.some(r => {
      const contact = contactById.get(r.contactId);
      return contact && (
        contact.name.toLowerCase().includes(q)
        || contact.handle.toLowerCase().includes(q)
      );
    });
    return doc.title.toLowerCase().includes(q)
      || doc.body.toLowerCase().includes(q)
      || docStatus(doc).kind.toLowerCase().includes(q)
      || recipientMatches;
  });
};

type StatusPillProps = {
  status: DocStatus;
  contactName?: string;
};

const StatusPill = ({ status, contactName }: StatusPillProps) => {
  const { t } = useTranslation();
  switch (status.kind) {
  case 'draft':
    return <span className={[style.pill, style.pillDraft].join(' ')}>{t('cloud.tresor.status.draft')}</span>;
  case 'sealed':
    return <span className={[style.pill, style.pillSealed].join(' ')}>{t('cloud.tresor.status.sealed')}</span>;
  case 'at-risk':
    return (
      <span className={[style.pill, style.pillAtRisk].join(' ')}>
        {t('cloud.tresor.status.atRisk', { count: status.days })}
      </span>
    );
  case 'released':
    return (
      <span className={[style.pill, style.pillReleased].join(' ')}>
        {t('cloud.tresor.status.releasedTo', { name: contactName ?? '' })} (demo)
      </span>
    );
  }
};

const LockIcon = ({ filled }: { filled: boolean }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" fill={filled ? 'currentColor' : 'none'} />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

type CardProps = {
  doc: TresorDoc;
};

const Card = ({ doc }: CardProps) => {
  const { contacts } = useCloud();
  const status = docStatus(doc);
  const releasedName = status.kind === 'released'
    ? contacts.find(c => c.id === status.contactId)?.name
    : undefined;
  const isDraft = status.kind === 'draft';
  const title = doc.title.trim() || 'Untitled';
  return (
    <Link to={`/cloud/tresor/${doc.id}`} className={style.card}>
      <div className={style.cardLock}><LockIcon filled={!isDraft} /></div>
      <div className={style.cardMain}>
        <div className={style.cardTitle}>{title}</div>
        {doc.recipients.length > 0 && (
          <RecipientRowPreview recipients={doc.recipients} />
        )}
      </div>
      <div className={style.cardRight}>
        <StatusPill status={status} contactName={releasedName} />
      </div>
    </Link>
  );
};

export const TresorList = () => {
  const { t } = useTranslation();
  const { contacts, docs } = useCloud();
  const [query, setQuery] = useState('');
  const filteredDocs = useMemo(
    () => filterDocs(docs, contacts, query),
    [contacts, docs, query],
  );
  return (
    <View fullscreen={false}>
      <ViewContent>
        <section className={style.page}>
          <header className={style.header}>
            <Link to="/cloud" className={style.backButton} aria-label={t('button.back')}>
              <ChevronLeftDark />
            </Link>
            <div className={style.headerActions}>
              <SearchInput
                className={style.search}
                placeholder={t('cloud.tresor.searchPlaceholder')}
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label={t('cloud.tresor.searchPlaceholder')}
              />
              <ButtonLink primary to="/cloud/tresor/new">
                + {t('cloud.tresor.newDocument')}
              </ButtonLink>
            </div>
          </header>

          {filteredDocs.length === 0 ? (
            <div className={style.empty}>
              {docs.length === 0 ? t('cloud.tresor.empty') : t('cloud.tresor.searchEmpty')}
            </div>
          ) : (
            <div className={style.cards}>
              {filteredDocs.map(d => <Card key={d.id} doc={d} />)}
            </div>
          )}
        </section>
      </ViewContent>
    </View>
  );
};
