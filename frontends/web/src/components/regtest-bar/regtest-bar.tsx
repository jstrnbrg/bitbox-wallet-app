// SPDX-License-Identifier: Apache-2.0

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { getRegtestStatus, regtestMine, regtestSend, regtestSetup } from '@/api/backend';
import { getReceiveAddressList, TAccount } from '@/api/account';
import { AppContext } from '@/contexts/AppContext';
import style from './regtest-bar.module.css';

type TProps = {
  accounts: TAccount[];
};

type TFeedback = {
  type: 'success' | 'error';
  message: string;
} | null;

export const RegtestBar = ({ accounts }: TProps) => {
  const { t } = useTranslation();
  const { isRegtest } = useContext(AppContext);
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState('');
  const [feedback, setFeedback] = useState<TFeedback>(null);

  // Check regtest status on mount to restore ready state across restarts.
  useEffect(() => {
    getRegtestStatus()
      .then(status => {
        if (status.ready) {
          setReady(true);
        }
      })
      .catch(console.error);
  }, []);

  // Derive the current account from the URL (e.g. /account/<code>).
  const currentAccount = useMemo(() => {
    const match = location.pathname.match(/^\/account\/([^/]+)/);
    if (!match) {
      return undefined;
    }
    return accounts.find(a => a.code === match[1]);
  }, [location.pathname, accounts]);

  const showFeedback = useCallback((type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
  }, []);

  const getErrorMessage = useCallback((errorCode?: string, fallbackMessage?: string, fallbackKey?: string) => {
    switch (errorCode) {
    case 'addressRequired':
      return t('regtestBar.errors.addressRequired');
    case 'invalidRequestBody':
      return t('regtestBar.errors.invalidRequestBody');
    case 'notInRegtestMode':
      return t('regtestBar.errors.notInRegtestMode');
    case 'setupRequired':
      return t('regtestBar.errors.setupRequired');
    default:
      return fallbackMessage || (fallbackKey ? t(`regtestBar.errors.${fallbackKey}`) : t('genericError'));
    }
  }, [t]);

  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  const handleSetup = useCallback(async () => {
    setLoading('setup');
    try {
      const result = await regtestSetup();
      if (result.success) {
        setReady(true);
        showFeedback('success', t('regtestBar.feedback.setupComplete'));
      } else {
        showFeedback('error', getErrorMessage(result.errorCode, result.errorMessage, 'setupFailed'));
      }
    } catch (e) {
      showFeedback('error', t('regtestBar.errors.setupFailed'));
    }
    setLoading('');
  }, [getErrorMessage, showFeedback, t]);

  const handleMine = useCallback(async () => {
    setLoading('mine');
    try {
      const result = await regtestMine();
      if (result.success) {
        showFeedback('success', t('regtestBar.feedback.mineComplete'));
      } else {
        showFeedback('error', getErrorMessage(result.errorCode, result.errorMessage, 'mineFailed'));
      }
    } catch (e) {
      showFeedback('error', t('regtestBar.errors.mineFailed'));
    }
    setLoading('');
  }, [getErrorMessage, showFeedback, t]);

  const handleSend = useCallback(async () => {
    if (!currentAccount) {
      showFeedback('error', t('regtestBar.errors.navigateToAccount'));
      return;
    }

    setLoading('send');
    try {
      const addressLists = await getReceiveAddressList(currentAccount.code)();
      if (!addressLists || addressLists.length === 0) {
        showFeedback('error', t('regtestBar.errors.noReceiveAddress'));
        setLoading('');
        return;
      }
      const address = addressLists[0].addresses[0].address;
      const result = await regtestSend(address);
      if (result.success) {
        showFeedback('success', t('regtestBar.feedback.sendComplete', { address: address.substring(0, 12) }));
      } else {
        showFeedback('error', getErrorMessage(result.errorCode, result.errorMessage, 'sendFailed'));
      }
    } catch (e) {
      showFeedback('error', t('regtestBar.errors.sendFailed'));
    }
    setLoading('');
  }, [currentAccount, getErrorMessage, showFeedback, t]);

  if (!isRegtest || !currentAccount || currentAccount.coinCode !== 'rbtc') {
    return null;
  }

  return (
    <div className={style.container}>
      <span className={style.label}>{t('regtestBar.title')}</span>
      <button
        className={style.button}
        onClick={handleSetup}
        disabled={loading !== '' || ready}
      >
        {loading === 'setup'
          ? t('regtestBar.buttons.settingUp')
          : ready
            ? t('regtestBar.buttons.ready')
            : t('regtestBar.buttons.setup')}
      </button>
      <button
        className={style.button}
        onClick={handleMine}
        disabled={loading !== '' || !ready}
      >
        {loading === 'mine' ? t('regtestBar.buttons.mining') : t('regtestBar.buttons.mine')}
      </button>
      <button
        className={style.button}
        onClick={handleSend}
        disabled={loading !== '' || !ready || !currentAccount || currentAccount.accountType === 'vault'}
      >
        {loading === 'send'
          ? t('regtestBar.buttons.sending')
          : currentAccount?.accountType === 'vault'
            ? t('regtestBar.buttons.sendUnavailable')
            : t('regtestBar.buttons.send')}
      </button>
      {feedback && (
        <span className={[style.feedback, feedback.type === 'success' ? style.success : style.error].join(' ')}>
          {feedback.message}
        </span>
      )}
    </div>
  );
};
