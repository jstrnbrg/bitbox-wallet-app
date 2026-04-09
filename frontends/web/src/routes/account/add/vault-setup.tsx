// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  completeVaultSetup,
  discardVaultSetup,
  enrollVaultSetupSigner,
  getAccounts,
  getVaultSetupDraft,
  importVault,
  NativeCoinCode,
  startVaultSetup,
  TVaultDraft,
  TVaultRecoveryFile,
} from '@/api/account';
import { BackButton } from '@/components/backbutton/backbutton';
import { Button, Checkbox, Input } from '@/components/forms';
import { GuidedContent, GuideWrapper, Header, Main } from '@/components/layout';
import { Message } from '@/components/message/message';
import { View, ViewButtons, ViewContent } from '@/components/view/view';
import styles from './vault-setup.module.css';

type TRouteParams = {
  draftId?: string;
};

const getDefaultVaultName = (coinCode?: NativeCoinCode | null) => {
  switch (coinCode) {
  case 'tbtc':
    return 'Bitcoin Testnet Vault';
  case 'rbtc':
    return 'Bitcoin Regtest Vault';
  default:
    return 'Bitcoin Vault';
  }
};

export const VaultSetup = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { draftId } = useParams<TRouteParams>();
  const [searchParams] = useSearchParams();
  const coinCode = searchParams.get('coinCode') as NativeCoinCode | null;
  const nameFromParams = searchParams.get('name');
  const mode = coinCode ? 'create' : 'import';
  const [draft, setDraft] = useState<TVaultDraft>();
  const [accountName, setAccountName] = useState(nameFromParams || getDefaultVaultName(coinCode));
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [importName, setImportName] = useState(getDefaultVaultName(coinCode));
  const [importRecoveryFile, setImportRecoveryFile] = useState<TVaultRecoveryFile>();
  const [importFileName, setImportFileName] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'devices' | 'backup'>('devices');
  const startedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const translateErrorCode = (errorCode: string) => {
    switch (errorCode) {
    case 'firmwareUpgradeRequired':
    case 'unsupportedFeature':
      return t(`device.${errorCode}`);
    default:
      return t(`error.${errorCode}`);
    }
  };

  // Auto-start vault creation when in create mode without an existing draft.
  useEffect(() => {
    if (draftId || mode !== 'create' || !coinCode || startedRef.current) {
      return;
    }
    startedRef.current = true;
    setBusy(true);
    startVaultSetup(coinCode, accountName || undefined)
      .then(result => {
        if (!result.success) {
          setErrorMessage(result.errorMessage || t('genericError'));
          return;
        }
        navigate(`/add-account/vault/${result.draft.id}`, { replace: true });
      })
      .catch(error => {
        console.error(error);
        setErrorMessage(t('genericError'));
      })
      .finally(() => setBusy(false));
  }, [draftId, mode, coinCode, accountName, navigate, t]);

  useEffect(() => {
    if (!draftId) {
      return;
    }
    setBusy(true);
    getVaultSetupDraft(draftId)
      .then(result => {
        if (!result.success) {
          setErrorMessage(result.errorMessage);
          return;
        }
        setDraft(result.draft);
        setAccountName(result.draft.name || getDefaultVaultName(result.draft.network));
      })
      .catch(error => {
        console.error(error);
        setErrorMessage(t('genericError'));
      })
      .finally(() => setBusy(false));
  }, [draftId, t]);

  const handleEnrollSigner = async () => {
    if (!draft) {
      return;
    }
    setBusy(true);
    try {
      const result = await enrollVaultSetupSigner(draft.id);
      if (!result.success) {
        if (result.errorCode) {
          setErrorMessage(translateErrorCode(result.errorCode));
        } else {
          setErrorMessage(result.errorMessage);
        }
        return;
      }
      setDraft(result.draft);
      setErrorMessage(undefined);
    } catch (error) {
      console.error(error);
      setErrorMessage(t('genericError'));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (!draft) {
      navigate('/settings/manage-accounts');
      return;
    }
    setBusy(true);
    try {
      await discardVaultSetup(draft.id);
      navigate('/settings/manage-accounts');
    } catch (error) {
      console.error(error);
      setErrorMessage(t('genericError'));
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (!draft) {
      return;
    }
    setBusy(true);
    try {
      const result = await completeVaultSetup(
        draft.id,
        accountName || draft.name || getDefaultVaultName(draft.network),
        recoveryAcknowledged,
      );
      if (!result.success || !result.accountCode) {
        if (result.errorCode) {
          setErrorMessage(translateErrorCode(result.errorCode));
        } else {
          setErrorMessage(result.errorMessage || t('genericError'));
        }
        return;
      }
      // Wait for the account to appear in the accounts list before navigating.
      // ReinitializeAccounts() fires a websocket event that the frontend picks up
      // asynchronously, so we poll briefly to avoid navigating before the account exists.
      const accountCode = result.accountCode;
      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        const accounts = await getAccounts();
        if (accounts.some(a => a.code === accountCode)) {
          navigate(`/account/${accountCode}`);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      // Navigate anyway after timeout — the account should appear shortly.
      navigate(`/account/${accountCode}`);
    } catch (error) {
      console.error(error);
      setErrorMessage(t('genericError'));
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as TVaultRecoveryFile;
      setImportRecoveryFile(parsed);
      setImportFileName(file.name);
      setErrorMessage(undefined);
    } catch {
      setImportRecoveryFile(undefined);
      setImportFileName(undefined);
      setErrorMessage(t('addAccount.vault.importInvalid'));
    }
    // Reset the input so the same file can be re-selected.
    event.target.value = '';
  };

  const handleImport = async () => {
    if (!importRecoveryFile) {
      return;
    }
    setBusy(true);
    try {
      const result = await importVault(importRecoveryFile, importName);
      if (!result.success || !result.accountCode) {
        if (result.errorCode) {
          setErrorMessage(translateErrorCode(result.errorCode));
        } else {
          setErrorMessage(result.errorMessage || t('genericError'));
        }
        return;
      }
      navigate(`/account/${result.accountCode}`);
    } catch (error) {
      console.error(error);
      setErrorMessage(t('addAccount.vault.importInvalid'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GuideWrapper>
      <GuidedContent>
        <Main>
          <Header title={<h2>{step === 'backup' ? t('addAccount.vault.backupTitle') : t('addAccount.vault.setup')}</h2>} />
          <View>
            <ViewContent>
              <div className={styles.content}>
                <Message type="warning" hidden={!errorMessage}>
                  {errorMessage}
                </Message>
                {draft && step === 'devices' ? (
                  <>
                    <p className={styles.description}>
                      {t('addAccount.vault.collectingDescription')}
                    </p>
                    <p className={styles.description}>
                      {t('addAccount.vault.progress', {
                        count: draft.participants.length,
                      })}
                    </p>
                    <div className={styles.deviceTable}>
                      {Array.from({ length: 3 }).map((_, index) => {
                        const participant = draft.participants[index];
                        return (
                          <div
                            className={[styles.deviceSlot, participant && styles.deviceSlotFilled].filter(Boolean).join(' ')}
                            key={index}>
                            <span className={styles.deviceSlotNumber}>
                              {t('addAccount.vault.signerLabel', { number: index + 1 })}
                            </span>
                            {participant ? (
                              <>
                                {participant.name && (
                                  <strong>{participant.name}</strong>
                                )}
                                <span className={styles.deviceFingerprint}>{participant.keyInfo.rootFingerprint}</span>
                                <code className={styles.deviceKeypath}>{participant.keyInfo.keypath}</code>
                              </>
                            ) : (
                              <span className={styles.deviceSlotEmpty}>
                                {t('addAccount.vault.notAdded')}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : draft ? (
                  <>
                    <p className={styles.sectionTitle}>{t('addAccount.vault.whatIsDescriptor')}</p>
                    <p className={styles.description}>
                      {t('addAccount.vault.whatIsDescriptorDescription1')}
                    </p>
                    <p className={styles.description}>
                      {t('addAccount.vault.whatIsDescriptorDescription2')}
                    </p>
                    <p className={styles.description}>
                      {t('addAccount.vault.whatIsDescriptorDescription3')}
                    </p>
                    <p className={styles.sectionTitle}>{t('addAccount.vault.onChainBackup')}</p>
                    <div className={styles.descriptorSection}>
                      <p className={styles.description}>
                        {t('addAccount.vault.onChainBackupAutoDescription')}
                      </p>
                      <Checkbox
                        checked={recoveryAcknowledged}
                        id="vault-recovery-ack"
                        onChange={event => setRecoveryAcknowledged(event.target.checked)}
                        title={t('addAccount.vault.onChainBackupAcknowledgement')}>
                        {t('addAccount.vault.onChainBackupAcknowledgement')}
                      </Checkbox>
                    </div>
                  </>
                ) : mode === 'import' ? (
                  <>
                    <p className={styles.description}>
                      {t('addAccount.vault.importDescription')}
                    </p>
                    <input
                      accept=".json,application/json"
                      className={styles.fileInput}
                      onChange={handleImportFile}
                      ref={fileInputRef}
                      type="file"
                    />
                    <Button
                      disabled={busy}
                      onClick={() => fileInputRef.current?.click()}
                      secondary>
                      {t('addAccount.vault.selectFile')}
                    </Button>
                    {importFileName && (
                      <p className={styles.selectedFile}>
                        {importFileName}
                      </p>
                    )}
                    <Input
                      id="vault-import-name"
                      onInput={event => setImportName(event.currentTarget.value)}
                      value={importName}
                    />
                  </>
                ) : null}
              </div>
            </ViewContent>
            <ViewButtons>
              {draft ? (
                <>
                  {step === 'devices' ? (
                    draft.state === 'collectingSigners' ? (
                      <Button primary disabled={busy} onClick={handleEnrollSigner}>
                        {t('addAccount.vault.enrollSigner')}
                      </Button>
                    ) : (
                      <Button primary onClick={() => setStep('backup')}>
                        {t('button.continue')}
                      </Button>
                    )
                  ) : (
                    <Button primary disabled={busy || !recoveryAcknowledged} onClick={handleComplete}>
                      {t('addAccount.vault.complete')}
                    </Button>
                  )}
                  <Button onClick={step === 'backup' ? () => setStep('devices') : handleDiscard} secondary>
                    {step === 'backup' ? t('button.back') : t('addAccount.vault.discard')}
                  </Button>
                </>
              ) : mode === 'import' ? (
                <>
                  <Button primary disabled={busy || !importRecoveryFile || !importName} onClick={handleImport}>
                    {t('addAccount.vault.import')}
                  </Button>
                  <BackButton enableEsc>
                    {t('button.back')}
                  </BackButton>
                </>
              ) : null}
            </ViewButtons>
          </View>
        </Main>
      </GuidedContent>
    </GuideWrapper>
  );
};
