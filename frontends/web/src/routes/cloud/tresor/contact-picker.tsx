// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/components/dialog/dialog';
import { useCloud } from '../state/context';
import { Avatar } from '../components/avatar';
import dialogStyle from '../contacts/dialog.module.css';
import style from './recipients-panel.module.css';

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (contactId: string) => void;
  excludeContactIds: string[];
};

export const ContactPicker = ({ open, onClose, onPick, excludeContactIds }: Props) => {
  const { t } = useTranslation();
  const { contacts } = useCloud();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) {
      setQuery('');
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter(c => !excludeContactIds.includes(c.id))
      .filter(c => !q || c.name.toLowerCase().includes(q) || c.handle.toLowerCase().includes(q));
  }, [contacts, excludeContactIds, query]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      medium
      title={t('cloud.tresor.picker.title')}>
      <input
        type="search"
        autoFocus
        className={dialogStyle.input}
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('cloud.tresor.picker.searchPlaceholder')}
        aria-label={t('cloud.tresor.picker.searchPlaceholder')}
      />
      {filtered.length === 0 ? (
        <div className={style.pickerEmpty}>{t('cloud.tresor.picker.empty')}</div>
      ) : (
        <ul className={style.pickerList}>
          {filtered.map(c => (
            <li key={c.id}>
              <button
                type="button"
                className={style.pickerRow}
                onClick={() => {
                  onPick(c.id); onClose();
                }}>
                <Avatar seed={c.handle} label={c.name} size={32} />
                <span className={style.pickerText}>
                  <span className={style.pickerName}>{c.name}</span>
                  <span className={style.pickerHandle}>{c.handle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
};
