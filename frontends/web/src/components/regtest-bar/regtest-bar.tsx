// SPDX-License-Identifier: Apache-2.0

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  const handleSetup = async () => {
    setLoading('setup');
    try {
      const result = await regtestSetup();
      if (result.success) {
        setReady(true);
        showFeedback('success', 'Setup complete');
      } else {
        showFeedback('error', result.errorMessage || 'Setup failed');
      }
    } catch (e) {
      showFeedback('error', 'Setup failed');
    }
    setLoading('');
  };

  const handleMine = async () => {
    setLoading('mine');
    try {
      const result = await regtestMine();
      if (result.success) {
        showFeedback('success', 'Mined 1 block');
      } else {
        showFeedback('error', result.errorMessage || 'Mine failed');
      }
    } catch (e) {
      showFeedback('error', 'Mine failed');
    }
    setLoading('');
  };

  const handleSend = async () => {
    if (!currentAccount) {
      showFeedback('error', 'Navigate to an account first');
      return;
    }

    setLoading('send');
    try {
      const addressLists = await getReceiveAddressList(currentAccount.code)();
      if (!addressLists || addressLists.length === 0) {
        showFeedback('error', 'No receive address available (account may not be synced yet)');
        setLoading('');
        return;
      }
      const address = addressLists[0].addresses[0].address;
      const result = await regtestSend(address);
      if (result.success) {
        showFeedback('success', `Sent 1 BTC to ${address.substring(0, 12)}...`);
      } else {
        showFeedback('error', result.errorMessage || 'Send failed');
      }
    } catch (e) {
      showFeedback('error', 'Send failed');
    }
    setLoading('');
  };

  if (!isRegtest || !currentAccount || currentAccount.coinCode !== 'rbtc') {
    return null;
  }

  return (
    <div className={style.container}>
      <span className={style.label}>REGTEST</span>
      <button
        className={style.button}
        onClick={handleSetup}
        disabled={loading !== '' || ready}
      >
        {loading === 'setup' ? 'Setting up...' : ready ? 'Ready' : 'Setup'}
      </button>
      <button
        className={style.button}
        onClick={handleMine}
        disabled={loading !== '' || !ready}
      >
        {loading === 'mine' ? 'Mining...' : 'Mine'}
      </button>
      <button
        className={style.button}
        onClick={handleSend}
        disabled={loading !== '' || !ready || !currentAccount || currentAccount.accountType === 'vault'}
      >
        {loading === 'send' ? 'Sending...' : currentAccount?.accountType === 'vault' ? 'Send (N/A for vaults)' : 'Send 1 BTC'}
      </button>
      {feedback && (
        <span className={[style.feedback, feedback.type === 'success' ? style.success : style.error].join(' ')}>
          {feedback.message}
        </span>
      )}
    </div>
  );
};
