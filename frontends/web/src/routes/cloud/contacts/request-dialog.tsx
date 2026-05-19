// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogButtons } from '@/components/dialog/dialog';
import { Button } from '@/components/forms';
import { useCloud } from '../state/context';
import type { Contact } from '../state/types';
import style from './dialog.module.css';

type Props = {
  contact: Contact;
  open: boolean;
  onClose: () => void;
};

const parseBtc = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  const sats = Math.round(n * 1e8);
  if (sats <= 0) {
    return null;
  }
  return sats;
};

export const RequestDialog = ({ contact, open, onClose }: Props) => {
  const { t } = useTranslation();
  const { createRequest } = useCloud();
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setAmount('');
      setMemo('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const sats = parseBtc(amount);
    if (sats === null) {
      setError(t('cloud.contacts.requestDialog.amountError'));
      return;
    }
    createRequest({ contactId: contact.id, amountSats: sats, memo: memo.trim() });
    onClose();
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      medium
      title={t('cloud.contacts.requestDialog.title', { name: contact.name })}>
      <form onSubmit={handleSubmit}>
        <label className={style.field}>
          <span className={style.fieldLabel}>
            {t('cloud.contacts.requestDialog.amountLabel')}
          </span>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            className={style.input}
            value={amount}
            onChange={handleAmountChange}
            placeholder={t('cloud.contacts.requestDialog.amountPlaceholder')}
          />
        </label>
        <label className={style.field}>
          <span className={style.fieldLabel}>
            {t('cloud.contacts.requestDialog.memoLabel')}
          </span>
          <input
            type="text"
            className={style.input}
            value={memo}
            onChange={e => setMemo(e.target.value)}
            placeholder={t('cloud.contacts.requestDialog.memoPlaceholder')}
          />
        </label>
        {error && <div className={style.error}>{error}</div>}
        <DialogButtons>
          <Button primary type="submit">
            {t('cloud.contacts.requestDialog.submit')}
          </Button>
          <Button secondary onClick={onClose}>
            {t('cloud.contacts.requestDialog.cancel')}
          </Button>
        </DialogButtons>
      </form>
    </Dialog>
  );
};
