// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Button } from '@/components/forms';
import { ChevronLeftDark } from '@/components/icon';
import { View, ViewContent } from '@/components/view/view';
import { useCloud } from '../state/context';
import { SEEDED_HANDLES } from '../state/seed';
import { Avatar } from '../components/avatar';
import { MessagesTab } from './messages-tab';
import { ActivityTab } from './activity-tab';
import { RequestDialog } from './request-dialog';
import { SendBtcDialog } from './send-btc-dialog';
import type { TCloudOutletContext } from '../layout';
import style from './detail.module.css';

type Tab = 'messages' | 'activity';

const VerifiedCheck = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="currentColor"
    aria-label="verified"
    className={style.verifiedIcon}>
    <path d="M12 2l2.4 2.4 3.3-.6 1.1 3.2 3.2 1.1-.6 3.3L24 12l-2.4 2.4.6 3.3-3.2 1.1-1.1 3.2-3.3-.6L12 22l-2.4-2.4-3.3.6-1.1-3.2-3.2-1.1.6-3.3L0 12l2.4-2.4-.6-3.3L5 5.2 6.1 2l3.3.6z" />
    <path d="M9.5 12.5l1.7 1.7 3.8-3.8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

const RequestIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

export const ContactDetail = () => {
  const { t } = useTranslation();
  const { contactId } = useParams<{ contactId: string }>();
  const { accounts } = useOutletContext<TCloudOutletContext>();
  const navigate = useNavigate();
  const { contacts } = useCloud();
  const contact = contacts.find(c => c.id === contactId);

  const [tab, setTab] = useState<Tab>('messages');
  const [menuOpen, setMenuOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  if (!contact) {
    return (
      <View fullscreen={false}>
        <ViewContent>
          <section className={style.page}>
            <div className={style.missing}>
              <p>{t('cloud.contacts.detail.missing')}</p>
              <Link to="/cloud/contacts" className={style.backLink}>
                <ChevronLeftDark />
                <span>{t('cloud.contacts.detail.back')}</span>
              </Link>
            </div>
          </section>
        </ViewContent>
      </View>
    );
  }

  const verified = contact.kind === 'device' || SEEDED_HANDLES.has(contact.handle);

  const handleSend = () => setSendOpen(true);
  const handleRequest = () => setRequestOpen(true);

  return (
    <View fullscreen={false}>
      <ViewContent>
        <section className={style.page}>
          <header className={style.header}>
            <button
              type="button"
              className={style.backButton}
              onClick={() => navigate('/cloud/contacts')}
              aria-label={t('cloud.contacts.detail.back')}>
              <ChevronLeftDark />
            </button>
            <Avatar seed={contact.handle} label={contact.name} size={64} />
            <div className={style.headerText}>
              <div className={style.nameRow}>
                <h1 className={style.name}>{contact.name}</h1>
                {verified && <VerifiedCheck />}
              </div>
              <div className={style.handle}>{contact.handle}</div>
            </div>
            <div className={style.menuWrap}>
              <button
                type="button"
                className={style.menuButton}
                onClick={() => setMenuOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={t('cloud.contacts.detail.menu')}>
                …
              </button>
              {menuOpen && (
                <ul className={style.menu} role="menu" onMouseLeave={() => setMenuOpen(false)}>
                  <li>
                    <button type="button" role="menuitem" className={style.menuItem} disabled>
                      {t('cloud.contacts.detail.menuItems.rename')}
                    </button>
                  </li>
                  <li>
                    <button type="button" role="menuitem" className={style.menuItem} disabled>
                      {t('cloud.contacts.detail.menuItems.remove')}
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </header>

          <div className={style.actionRow}>
            <Button secondary className={style.actionButton} onClick={handleSend}>
              <SendIcon />
              <span>{t('cloud.contacts.detail.actions.send')}</span>
            </Button>
            <Button secondary className={style.actionButton} onClick={handleRequest}>
              <RequestIcon />
              <span>{t('cloud.contacts.detail.actions.request')}</span>
            </Button>
          </div>

          <div className={style.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'messages'}
              className={[style.tab, tab === 'messages' ? style.tabActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab('messages')}>
              {t('cloud.contacts.detail.tabs.messages')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'activity'}
              className={[style.tab, tab === 'activity' ? style.tabActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab('activity')}>
              {t('cloud.contacts.detail.tabs.activity')}
            </button>
          </div>

          <div className={style.tabPanel}>
            {tab === 'messages' && (
              <MessagesTab contact={contact} />
            )}
            {tab === 'activity' && (
              <ActivityTab contact={contact} />
            )}
          </div>

          <RequestDialog
            contact={contact}
            open={requestOpen}
            onClose={() => setRequestOpen(false)}
          />
          <SendBtcDialog
            accounts={accounts}
            contact={contact}
            open={sendOpen}
            onClose={() => setSendOpen(false)}
            onDemoSend={() => setToast(t('cloud.contacts.sendDialog.demoNotice'))}
          />
          {toast && (
            <div className={style.toast} role="status">{toast}</div>
          )}
        </section>
      </ViewContent>
    </View>
  );
};
