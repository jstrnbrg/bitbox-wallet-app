// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronLeftDark } from '@/components/icon';
import { View, ViewContent } from '@/components/view/view';
import { useCloud } from '../state/context';
import { getNotificationItems, type NotificationItem } from './data';
import style from './list.module.css';

const NotificationIcon = ({ kind }: { kind: NotificationItem['kind'] }) => (
  <span className={[
    style.icon,
    kind === 'payment-request' ? style.iconPayment : style.iconMessage,
  ].join(' ')}>
    {kind === 'payment-request' ? '$' : ''}
  </span>
);

const Row = ({ item }: { item: NotificationItem }) => {
  const { t } = useTranslation();
  const text = item.kind === 'payment-request'
    ? t('cloud.contacts.inbox.requestFrom', { name: item.contact.name, memo: item.request.memo })
    : t('cloud.contacts.inbox.messageFrom', { name: item.contact.name, count: item.count });

  return (
    <Link to={`/cloud/contacts/${item.contact.id}`} className={style.row}>
      <NotificationIcon kind={item.kind} />
      <div className={style.rowText}>
        <div className={style.rowTitle}>{text}</div>
        <div className={style.rowHandle}>{item.contact.handle}</div>
      </div>
    </Link>
  );
};

export const NotificationsList = () => {
  const { t } = useTranslation();
  const { contacts, messages, requests } = useCloud();
  const items = getNotificationItems({ contacts, messages, requests });

  return (
    <View fullscreen={false}>
      <ViewContent>
        <section className={style.page}>
          <header className={style.header}>
            <Link to="/cloud" className={style.backButton} aria-label={t('button.back')}>
              <ChevronLeftDark />
            </Link>
          </header>

          {items.length === 0 ? (
            <div className={style.empty}>{t('cloud.notifications.empty')}</div>
          ) : (
            <div className={style.list}>
              {items.map(item => <Row key={item.id} item={item} />)}
            </div>
          )}
        </section>
      </ViewContent>
    </View>
  );
};
