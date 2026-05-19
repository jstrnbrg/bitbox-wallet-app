// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { View, ViewContent } from '@/components/view/view';
import { Button } from '@/components/forms';
import { ChevronLeftDark } from '@/components/icon';
import { SubTitle } from '@/components/title';
import { useCloud } from '../state/context';
import { Avatar } from '../components/avatar';
import style from './add.module.css';

type Tab = 'scan' | 'paste';

type Resolved = {
  handle: string;
  pubkey: string;
};

const SAMPLE_PAYLOAD = 'bitbox:cedar-thrush-6611?pk=02fe...11ab';

const parsePayload = (raw: string): Resolved | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  // Strip leading "bitbox:" if present.
  const noScheme = trimmed.replace(/^bitbox:/i, '');
  // Split handle from query string.
  const [handle, query = ''] = noScheme.split('?');
  if (!handle) {
    return null;
  }
  const params = new URLSearchParams(query);
  const pubkey = params.get('pk') || `02${handle.slice(0, 4).padEnd(4, '0')}...mock`;
  return { handle, pubkey };
};

export const AddContact = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addContact } = useCloud();
  const [tab, setTab] = useState<Tab>('scan');
  const [pasteValue, setPasteValue] = useState('');
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [nickname, setNickname] = useState('');

  const handleUseSample = () => {
    const r = parsePayload(SAMPLE_PAYLOAD);
    if (r) {
      setResolved(r);
      setNickname(t('cloud.contacts.add.defaultNickname'));
    }
  };

  const handleContinuePaste = () => {
    const r = parsePayload(pasteValue);
    if (r) {
      setResolved(r);
      setNickname(t('cloud.contacts.add.defaultNickname'));
    }
  };

  const handleAdd = () => {
    if (!resolved) {
      return;
    }
    addContact({
      name: nickname.trim() || t('cloud.contacts.add.defaultNickname'),
      handle: resolved.handle,
      pubkey: resolved.pubkey,
      kind: 'person',
    });
    navigate('/cloud/contacts');
  };

  const handleBack = () => {
    if (resolved) {
      setResolved(null);
      return;
    }
    navigate('/cloud/contacts');
  };

  if (resolved) {
    return (
      <View fullscreen={false}>
        <ViewContent>
          <section className={style.page}>
            <header className={style.header}>
              <button type="button" className={style.backButton} onClick={handleBack}>
                <ChevronLeftDark />
                <span>{t('cloud.contacts.add.back')}</span>
              </button>
            </header>
            <div className={style.confirmCard}>
              <SubTitle className={style.title}>{t('cloud.contacts.add.confirmTitle')}</SubTitle>
              <div className={style.confirmHead}>
                <Avatar seed={resolved.handle} label={resolved.handle} size={56} />
                <div className={style.confirmHeadText}>
                  <div className={style.confirmName}>{t('cloud.contacts.add.resolvedName')}</div>
                  <div className={style.confirmHandle}>{resolved.handle}</div>
                  <div className={style.confirmPubkey}>{resolved.pubkey}</div>
                </div>
              </div>
              <label className={style.field}>
                <span className={style.fieldLabel}>{t('cloud.contacts.add.nickname')}</span>
                <input
                  type="text"
                  className={style.input}
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  placeholder={t('cloud.contacts.add.nicknamePlaceholder')}
                />
              </label>
              <div className={style.confirmActions}>
                <Button primary onClick={handleAdd}>
                  {t('cloud.contacts.add.addButton')}
                </Button>
                <Button secondary onClick={handleBack}>
                  {t('cloud.contacts.add.cancel')}
                </Button>
              </div>
            </div>
          </section>
        </ViewContent>
      </View>
    );
  }

  return (
    <View fullscreen={false}>
      <ViewContent>
        <section className={style.page}>
          <header className={style.header}>
            <Link to="/cloud/contacts" className={style.backButton}>
              <ChevronLeftDark />
              <span>{t('cloud.contacts.add.back')}</span>
            </Link>
          </header>

          <div className={style.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'scan'}
              className={[style.tab, tab === 'scan' ? style.tabActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab('scan')}>
              {t('cloud.contacts.add.tabs.scan')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'paste'}
              className={[style.tab, tab === 'paste' ? style.tabActive : ''].filter(Boolean).join(' ')}
              onClick={() => setTab('paste')}>
              {t('cloud.contacts.add.tabs.paste')}
            </button>
          </div>

          {tab === 'scan' && (
            <div className={style.scan}>
              <div className={style.cameraPlaceholder}>
                <span>{t('cloud.contacts.add.cameraUnavailable')}</span>
              </div>
              <Button secondary onClick={handleUseSample}>
                {t('cloud.contacts.add.useSample')}
              </Button>
            </div>
          )}

          {tab === 'paste' && (
            <div className={style.paste}>
              <label className={style.field}>
                <span className={style.fieldLabel}>{t('cloud.contacts.add.pasteLabel')}</span>
                <input
                  type="text"
                  className={style.input}
                  placeholder="bitbox:cedar-thrush-6611?pk=02fe...11ab"
                  value={pasteValue}
                  onChange={e => setPasteValue(e.target.value)}
                />
              </label>
              <Button
                primary
                disabled={!parsePayload(pasteValue)}
                onClick={handleContinuePaste}>
                {t('cloud.contacts.add.continue')}
              </Button>
            </div>
          )}
        </section>
      </ViewContent>
    </View>
  );
};
