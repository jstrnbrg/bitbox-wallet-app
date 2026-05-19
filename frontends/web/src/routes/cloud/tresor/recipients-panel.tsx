// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useCloud } from '../state/context';
import { docStatus } from './status';
import { ContactPicker } from './contact-picker';
import type { TresorDoc, TresorRecipient } from '../state/types';
import style from './recipients-panel.module.css';

const STANDARD_DELAYS: Array<number | null | 'custom'> = [null, 30, 90, 365, 'custom'];

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
    return t('cloud.tresor.editor.ago.minutes', { count: Math.floor(diff / MINUTE) });
  }
  if (diff < DAY) {
    return t('cloud.tresor.editor.ago.hours', { count: Math.floor(diff / HOUR) });
  }
  if (diff < MONTH) {
    return t('cloud.tresor.editor.ago.days', { count: Math.floor(diff / DAY) });
  }
  if (diff < YEAR) {
    return t('cloud.tresor.editor.ago.months', { count: Math.floor(diff / MONTH) });
  }
  return t('cloud.tresor.editor.ago.years', { count: Math.floor(diff / YEAR) });
};

const delayLabelKey = (d: number | null): string => {
  if (d === null) {
    return 'cloud.tresor.recipients.delays.never';
  }
  if (d === 30) {
    return 'cloud.tresor.recipients.delays.30';
  }
  if (d === 90) {
    return 'cloud.tresor.recipients.delays.90';
  }
  if (d === 365) {
    return 'cloud.tresor.recipients.delays.365';
  }
  return '';
};

const isStandard = (d: number | null): boolean =>
  d === null || d === 30 || d === 90 || d === 365;

const LockOpenIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0" />
  </svg>
);

type RowProps = {
  recipient: TresorRecipient;
  contact: { name: string; handle: string };
  onChange: (r: TresorRecipient) => void;
  onRemove: () => void;
};

const RecipientRow = ({ recipient, contact, onChange, onRemove }: RowProps) => {
  const { t } = useTranslation();
  const released = recipient.releasedAt !== undefined;
  const [customOpen, setCustomOpen] = useState(
    !released && recipient.unlockDelayDays !== null && !isStandard(recipient.unlockDelayDays),
  );
  const [customValue, setCustomValue] = useState(() => {
    const d = recipient.unlockDelayDays;
    if (d === null || isStandard(d)) {
      return '14';
    }
    return String(d);
  });
  const [customUnit, setCustomUnit] = useState<'days' | 'months' | 'years'>('days');

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === 'custom') {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    const next: TresorRecipient = {
      ...recipient,
      unlockDelayDays: v === 'null' ? null : Number(v),
    };
    onChange(next);
  };

  const applyCustom = () => {
    const n = Number(customValue);
    if (!Number.isFinite(n) || n <= 0) {
      return;
    }
    const multiplier = customUnit === 'days' ? 1 : customUnit === 'months' ? 30 : 365;
    onChange({ ...recipient, unlockDelayDays: Math.round(n * multiplier) });
  };

  const currentSelectValue = (() => {
    const d = recipient.unlockDelayDays;
    if (customOpen) {
      return 'custom';
    }
    if (d === null) {
      return 'null';
    }
    if (isStandard(d)) {
      return String(d);
    }
    return 'custom';
  })();

  return (
    <li className={style.row}>
      <div className={style.rowText}>
        <div className={style.rowName}>{contact.name}</div>
        <div className={style.rowHandle}>{contact.handle}</div>
      </div>
      <div className={style.rowControls}>
        {released ? (
          <span className={style.released}>
            <LockOpenIcon />
            <span>{t('cloud.tresor.recipients.releasedAgo', { ago: formatAgo(recipient.releasedAt!, t) })}</span>
          </span>
        ) : (
          <>
            <label className={style.delayWrap}>
              <span className={style.srOnly}>{t('cloud.tresor.recipients.delayLabel')}</span>
              <select
                className={style.delaySelect}
                value={currentSelectValue}
                onChange={handleSelectChange}>
                {STANDARD_DELAYS.map(opt => {
                  if (opt === 'custom') {
                    return (
                      <option key="custom" value="custom">
                        {t('cloud.tresor.recipients.delays.custom')}
                      </option>
                    );
                  }
                  const key = delayLabelKey(opt);
                  return (
                    <option key={String(opt)} value={opt === null ? 'null' : String(opt)}>
                      {t(key)}
                    </option>
                  );
                })}
              </select>
            </label>
            <button
              type="button"
              className={style.removeButton}
              onClick={onRemove}
              aria-label={t('cloud.tresor.recipients.remove')}>
              ×
            </button>
          </>
        )}
      </div>
      {customOpen && !released && (
        <div className={style.customRow}>
          <span className={style.srOnly}>{t('cloud.tresor.recipients.customLabel')}</span>
          <input
            type="number"
            min="1"
            className={style.customInput}
            value={customValue}
            onChange={e => setCustomValue(e.target.value)}
          />
          <select
            className={style.customUnit}
            value={customUnit}
            onChange={e => setCustomUnit(e.target.value as 'days' | 'months' | 'years')}>
            <option value="days">{t('cloud.tresor.recipients.customUnit.days')}</option>
            <option value="months">{t('cloud.tresor.recipients.customUnit.months')}</option>
            <option value="years">{t('cloud.tresor.recipients.customUnit.years')}</option>
          </select>
          <button type="button" className={style.customApply} onClick={applyCustom}>
            {t('cloud.tresor.recipients.customApply')}
          </button>
        </div>
      )}
    </li>
  );
};

type Props = {
  doc: TresorDoc;
};

export const RecipientsPanel = ({ doc }: Props) => {
  const { t } = useTranslation();
  const { contacts, updateDoc } = useCloud();
  const [pickerOpen, setPickerOpen] = useState(false);

  const status = docStatus(doc);
  const recipientCount = doc.recipients.length;
  const pendingCount = doc.recipients.filter(r => r.releasedAt === undefined).length;

  const updateRecipient = (next: TresorRecipient) => {
    updateDoc(doc.id, {
      recipients: doc.recipients.map(r =>
        r.contactId === next.contactId ? next : r,
      ),
    });
  };

  const removeRecipient = (contactId: string) => {
    updateDoc(doc.id, {
      recipients: doc.recipients.filter(r => r.contactId !== contactId),
    });
  };

  const addRecipient = (contactId: string) => {
    if (doc.recipients.some(r => r.contactId === contactId)) {
      return;
    }
    updateDoc(doc.id, {
      recipients: [...doc.recipients, { contactId, unlockDelayDays: null }],
    });
  };

  const footer = (() => {
    switch (status.kind) {
    case 'draft':
      return t('cloud.tresor.recipients.footer.draft');
    case 'sealed':
      return t('cloud.tresor.recipients.footer.sealed', { count: recipientCount });
    case 'at-risk':
      return t('cloud.tresor.recipients.footer.atRisk', {
        count: recipientCount,
        days: status.days,
      });
    case 'released': {
      const c = contacts.find(x => x.id === status.contactId);
      const name = c?.name ?? '';
      const others = pendingCount; // recipients not yet released
      if (others <= 0) {
        return t('cloud.tresor.recipients.footer.releasedZero', { name });
      }
      return t('cloud.tresor.recipients.footer.released', { name, count: others });
    }
    }
  })();

  return (
    <aside className={style.panel}>
      <header className={style.panelHeader}>
        <h2 className={style.panelTitle}>{t('cloud.tresor.recipients.title')}</h2>
        <button
          type="button"
          className={style.addButton}
          onClick={() => setPickerOpen(true)}>
          + {t('cloud.tresor.recipients.addRecipient')}
        </button>
      </header>
      {doc.recipients.length > 0 && (
        <ul className={style.list}>
          {doc.recipients.map(r => {
            const c = contacts.find(x => x.id === r.contactId);
            if (!c) {
              return null;
            }
            return (
              <RecipientRow
                key={r.contactId}
                recipient={r}
                contact={c}
                onChange={updateRecipient}
                onRemove={() => removeRecipient(r.contactId)}
              />
            );
          })}
        </ul>
      )}
      <p className={style.footer}>{footer}</p>
      <ContactPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addRecipient}
        excludeContactIds={doc.recipients.map(r => r.contactId)}
      />
    </aside>
  );
};
