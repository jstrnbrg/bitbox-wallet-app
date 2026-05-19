// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ButtonLink } from '@/components/forms/button';
import { ChevronLeftDark } from '@/components/icon';
import { SearchInput } from '@/components/forms/search-input';
import { View, ViewContent } from '@/components/view/view';
import { useCloud } from '../state/context';
import { Avatar } from '../components/avatar';
import type { Contact } from '../state/types';
import style from './list.module.css';

const filterContacts = (contacts: Contact[], query: string): Contact[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return contacts;
  }
  return contacts.filter(c =>
    c.name.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q),
  );
};

const InboxBanner = () => {
  const { t } = useTranslation();
  const { requests, messages, contacts } = useCloud();
  const [expanded, setExpanded] = useState(false);

  const pendingIncomingRequests = requests.filter(r => r.status === 'pending' && r.direction === 'in');
  const unreadByContact = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of contacts) {
      const unread = messages(c.id).filter(m => m.from === 'them' && !m.readAt).length;
      if (unread > 0) {
        map.set(c.id, unread);
      }
    }
    return map;
  }, [contacts, messages]);
  const totalUnread = Array.from(unreadByContact.values()).reduce((a, b) => a + b, 0);

  if (pendingIncomingRequests.length === 0 && totalUnread === 0) {
    return null;
  }

  const summaryParts: string[] = [];
  if (pendingIncomingRequests.length > 0) {
    summaryParts.push(t('cloud.contacts.inbox.pending', { count: pendingIncomingRequests.length }));
  }
  if (totalUnread > 0) {
    summaryParts.push(t('cloud.contacts.inbox.unread', { count: totalUnread }));
  }

  const contactById = (id: string) => contacts.find(c => c.id === id);

  return (
    <div className={style.inbox}>
      <button
        type="button"
        className={style.inboxSummary}
        aria-expanded={expanded}
        onClick={() => setExpanded(e => !e)}>
        <span className={style.inboxDot} />
        <span>{summaryParts.join(' · ')}</span>
        <span className={[style.chevron, expanded ? style.chevronOpen : ''].filter(Boolean).join(' ')}>&#9662;</span>
      </button>
      {expanded && (
        <ul className={style.inboxItems}>
          {pendingIncomingRequests.map(r => {
            const c = contactById(r.contactId);
            if (!c) {
              return null;
            }
            return (
              <li key={`req-${r.id}`} className={style.inboxItem}>
                <span className={style.inboxBadge}>$</span>
                <span className={style.inboxText}>
                  {t('cloud.contacts.inbox.requestFrom', { name: c.name, memo: r.memo })}
                </span>
                <Link to={`/cloud/contacts/${c.id}`} className={style.inboxLink}>
                  {t('cloud.contacts.inbox.view')}
                </Link>
              </li>
            );
          })}
          {Array.from(unreadByContact.entries()).map(([cid, count]) => {
            const c = contactById(cid);
            if (!c) {
              return null;
            }
            return (
              <li key={`msg-${cid}`} className={style.inboxItem}>
                <span className={[style.inboxBadge, style.inboxBadgeMsg].join(' ')} />
                <span className={style.inboxText}>
                  {t('cloud.contacts.inbox.messageFrom', { name: c.name, count })}
                </span>
                <Link to={`/cloud/contacts/${c.id}`} className={style.inboxLink}>
                  {t('cloud.contacts.inbox.view')}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

type ContactRowProps = {
  contact: Contact;
  hasUnread: boolean;
  hasRequest: boolean;
};

const ContactRow = ({ contact, hasUnread, hasRequest }: ContactRowProps) => (
  <Link to={`/cloud/contacts/${contact.id}`} className={style.row}>
    <Avatar seed={contact.handle} label={contact.name} size={40} />
    <div className={style.rowText}>
      <div className={style.rowName}>{contact.name}</div>
      <div className={style.rowHandle}>{contact.handle}</div>
    </div>
    <div className={style.rowBadges}>
      {hasRequest && <span className={[style.badge, style.badgeRequest].join(' ')}>$</span>}
      {hasUnread && <span className={style.unreadDot} aria-hidden="true" />}
    </div>
  </Link>
);

export const ContactsList = () => {
  const { t } = useTranslation();
  const { contacts, requests, messages } = useCloud();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => filterContacts(contacts, query), [contacts, query]);

  const devices = filtered.filter(c => c.kind === 'device');
  const people = filtered.filter(c => c.kind === 'person');

  const hasUnread = (contactId: string) =>
    messages(contactId).some(m => m.from === 'them' && !m.readAt);
  const hasIncomingRequest = (contactId: string) =>
    requests.some(r => r.contactId === contactId && r.direction === 'in' && r.status === 'pending');

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
                placeholder={t('cloud.contacts.searchPlaceholder')}
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label={t('cloud.contacts.searchPlaceholder')}
              />
              <ButtonLink primary to="/cloud/contacts/add">
                + {t('cloud.contacts.addAction')}
              </ButtonLink>
            </div>
          </header>

          <InboxBanner />

          {devices.length > 0 && (
            <section className={style.group}>
              <h2 className={style.groupTitle}>{t('cloud.contacts.groups.devices')}</h2>
              <div className={style.list}>
                {devices.map(c => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    hasUnread={hasUnread(c.id)}
                    hasRequest={hasIncomingRequest(c.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {people.length > 0 && (
            <section className={style.group}>
              <h2 className={style.groupTitle}>{t('cloud.contacts.groups.people')}</h2>
              <div className={style.list}>
                {people.map(c => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    hasUnread={hasUnread(c.id)}
                    hasRequest={hasIncomingRequest(c.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {devices.length === 0 && people.length === 0 && (
            <div className={style.empty}>{t('cloud.contacts.empty')}</div>
          )}
        </section>
      </ViewContent>
    </View>
  );
};
