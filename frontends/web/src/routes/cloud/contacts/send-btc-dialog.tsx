// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TAccount } from '@/api/account';
import { Dialog, DialogButtons } from '@/components/dialog/dialog';
import { Button } from '@/components/forms';
import { Logo } from '@/components/icon/logo';
import type { Contact } from '../state/types';
import style from './dialog.module.css';

type TSendAccount = Pick<TAccount, 'code' | 'coinCode' | 'coinName' | 'name'>;

type Props = {
  accounts: TSendAccount[];
  contact: Contact;
  open: boolean;
  onClose: () => void;
  onDemoSend: () => void;
};

const demoAccounts: TSendAccount[] = [
  { code: 'demo-btc', coinCode: 'btc', coinName: 'Bitcoin', name: 'Bitcoin' },
  { code: 'demo-eth', coinCode: 'eth', coinName: 'Ethereum', name: 'Ethereum' },
  { code: 'demo-ltc', coinCode: 'ltc', coinName: 'Litecoin', name: 'Litecoin' },
];

// Build a stable-looking faux bc1 address from the handle.
const fauxAddressFor = (handle: string) => {
  const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  // Per-character mulberry-style hash; re-seeded with the position so consecutive
  // characters of the suffix don't collapse into runs.
  const step = (seed: number) => {
    let t = (seed + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
  let h = 2166136261 >>> 0;
  for (let i = 0; i < handle.length; i++) {
    h = Math.imul(h ^ handle.charCodeAt(i), 16777619) >>> 0;
  }
  let suffix = '';
  for (let i = 0; i < 30; i++) {
    const v = step(h + i * 0x9e3779b1);
    suffix += alphabet[v & 31];
  }
  return `bc1q${suffix}`;
};

export const SendBtcDialog = ({ accounts, contact, open, onClose, onDemoSend }: Props) => {
  const { t } = useTranslation();
  const availableAccounts = accounts.length > 0 ? accounts : demoAccounts;
  const [amount, setAmount] = useState('');
  const [selectedAccountCode, setSelectedAccountCode] = useState('');

  useEffect(() => {
    if (open) {
      setAmount('');
      setSelectedAccountCode(availableAccounts[0]?.code ?? '');
    }
  }, [availableAccounts, open]);

  const address = fauxAddressFor(contact.handle);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onDemoSend();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      medium
      title={t('cloud.contacts.sendDialog.title', { name: contact.name })}>
      <form onSubmit={handleSubmit}>
        <div className={style.field}>
          <span className={style.fieldLabel}>
            {t('cloud.contacts.sendDialog.fromLabel')}
          </span>
          {availableAccounts.length === 0 ? (
            <div className={style.staticValue}>
              <span className={style.muted}>{t('cloud.contacts.sendDialog.noAccounts')}</span>
            </div>
          ) : (
            <div className={style.accountList}>
              {availableAccounts.map(account => (
                <label
                  key={account.code}
                  className={[
                    style.accountRow,
                    account.code === selectedAccountCode ? style.accountRowSelected : '',
                  ].filter(Boolean).join(' ')}>
                  <input
                    type="radio"
                    name="fromAccount"
                    value={account.code}
                    checked={account.code === selectedAccountCode}
                    onChange={() => setSelectedAccountCode(account.code)}
                  />
                  <Logo coinCode={account.coinCode} alt={account.coinName} className={style.accountIcon} />
                  <span className={style.accountName}>{account.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className={style.field}>
          <span className={style.fieldLabel}>
            {t('cloud.contacts.sendDialog.toLabel')}
          </span>
          <div className={style.staticValue}>
            <span>{contact.name}</span>
            <span className={style.muted}>{t('cloud.contacts.sendDialog.toSuffix')}</span>
          </div>
        </div>
        <div className={style.field}>
          <span className={style.fieldLabel}>
            {t('cloud.contacts.sendDialog.addressLabel')}
          </span>
          <div className={style.addressRow}>
            <code className={style.addressValue}>{address}</code>
            <span className={style.badge}>
              {t('cloud.contacts.sendDialog.viaPaymentCode')}
            </span>
          </div>
        </div>
        <label className={style.field}>
          <span className={style.fieldLabel}>
            {t('cloud.contacts.sendDialog.amountLabel')}
          </span>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            className={style.input}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder={t('cloud.contacts.sendDialog.amountPlaceholder')}
          />
        </label>
        <DialogButtons>
          <Button primary type="submit">
            {t('cloud.contacts.sendDialog.submit')}
          </Button>
          <Button secondary onClick={onClose}>
            {t('cloud.contacts.sendDialog.cancel')}
          </Button>
        </DialogButtons>
      </form>
    </Dialog>
  );
};
