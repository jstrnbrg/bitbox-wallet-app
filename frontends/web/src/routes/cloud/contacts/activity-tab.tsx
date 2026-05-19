// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next';
import { useCloud } from '../state/context';
import type { Contact, PaymentReq } from '../state/types';
import style from './activity-tab.module.css';

type Props = {
  contact: Contact;
};

const formatBtc = (sats: number) => {
  const btc = sats / 1e8;
  // Up to 8 decimals, trim trailing zeros while keeping at least 4.
  const s = btc.toFixed(8);
  return s.replace(/(\.\d{4}\d*?)0+$/, '$1').replace(/\.$/, '');
};

const formatDate = (ts: number) => {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};

const formatDateTime = (ts: number) => {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const StatusPill = ({ status }: { status: PaymentReq['status'] }) => {
  const { t } = useTranslation();
  return (
    <span
      className={[
        style.statusPill,
        status === 'pending' ? style.statusPending : '',
        status === 'paid' ? style.statusPaid : '',
        status === 'declined' ? style.statusDeclined : '',
      ].filter(Boolean).join(' ')}>
      {t(`cloud.contacts.activity.status.${status}`)}
    </span>
  );
};

export const ActivityTab = ({ contact }: Props) => {
  const { t } = useTranslation();
  const { requests, markRequestPaid, markRequestDeclined } = useCloud();

  const contactRequests = requests
    .filter(r => r.contactId === contact.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className={style.tab}>
      {contactRequests.length === 0 && (
        <div className={style.empty}>{t('cloud.contacts.activity.empty')}</div>
      )}
      <ul className={style.list}>
        {contactRequests.map(r => {
          const incoming = r.direction === 'in';
          const canAct = r.status === 'pending' && incoming;
          return (
            <li key={r.id} className={style.row}>
              <div
                className={[
                  style.arrow,
                  incoming ? style.arrowIn : style.arrowOut,
                ].join(' ')}
                aria-label={t(`cloud.contacts.activity.direction${incoming ? 'In' : 'Out'}`)}>
                {incoming ? '↘' : '↗'}
              </div>
              <div className={style.rowMain}>
                <div className={style.rowTop}>
                  <span className={style.amount}>{formatBtc(r.amountSats)} BTC</span>
                  <StatusPill status={r.status} />
                </div>
                <div className={style.memo}>{r.memo}</div>
                <div className={style.timestamp}>{formatDateTime(r.createdAt)}</div>
                {canAct && (
                  <div className={style.actions}>
                    <button
                      type="button"
                      className={style.actionPrimary}
                      onClick={() => markRequestPaid(r.id)}>
                      {t('cloud.contacts.activity.markPaid')}
                    </button>
                    <button
                      type="button"
                      className={style.actionSecondary}
                      onClick={() => markRequestDeclined(r.id)}>
                      {t('cloud.contacts.activity.decline')}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
        <li className={style.pairedRow}>
          {t('cloud.contacts.activity.pairedOn', { date: formatDate(contact.pairedAt) })}
        </li>
      </ul>
    </div>
  );
};
