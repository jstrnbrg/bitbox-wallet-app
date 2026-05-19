// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { View, ViewContent } from '@/components/view/view';
import style from './cloud.module.css';
import { FeatureTile } from './components/feature-tile';
import { IdentityCard } from './components/identity-card';
import { IdentitySelector } from './components/identity-selector';
import { getNotificationItems } from './notifications/data';
import { useCloud } from './state/context';

const ContactsIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="22"
    height="22"
    aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="M20 8v6" />
    <path d="M23 11h-6" />
  </svg>
);

const TresorIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="22"
    height="22"
    aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const SubscriptionIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="22"
    height="22"
    aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18" />
    <path d="M7 15h4" />
  </svg>
);

const SettingsIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="22"
    height="22"
    aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" />
  </svg>
);

const NotificationIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="22"
    height="22"
    aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

export const CloudDashboard = () => {
  const { t } = useTranslation();
  const { contacts, docs, messages, requests } = useCloud();
  const notificationCount = getNotificationItems({ contacts, messages, requests }).length;
  return (
    <View fullscreen={false}>
      <ViewContent>
        <div className={style.dashboard}>
          <div className={style.topRow}>
            <IdentitySelector />
            <Link
              to="/cloud/notifications"
              className={style.notificationButton}
              aria-label={t('cloud.notifications.label', { count: notificationCount })}>
              <NotificationIcon />
              {notificationCount > 0 && (
                <span className={style.notificationBadge}>{notificationCount}</span>
              )}
            </Link>
          </div>
          <IdentityCard />
          <div className={style.tiles}>
            <FeatureTile
              to="/cloud/contacts"
              icon={<ContactsIcon />}
              title={t('cloud.tiles.contacts.title')}
              subtitle={t('cloud.tiles.contacts.subtitle', { count: contacts.length })}
            />
            <FeatureTile
              to="/cloud/tresor"
              icon={<TresorIcon />}
              title={t('cloud.tiles.tresor.title')}
              subtitle={t('cloud.tiles.tresor.subtitle', { count: docs.length })}
            />
            <FeatureTile
              icon={<SubscriptionIcon />}
              title={t('cloud.tiles.subscription.title')}
              subtitle={t('cloud.tiles.subscription.subtitle')}
            />
            <FeatureTile
              icon={<SettingsIcon />}
              title={t('cloud.tiles.settings.title')}
              subtitle={t('cloud.tiles.settings.subtitle')}
            />
          </div>
        </div>
      </ViewContent>
    </View>
  );
};
