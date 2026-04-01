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
  getVaultSetupRecoveryFile,
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
  const [recoveryFile, setRecoveryFile] = useState<TVaultRecoveryFile>();
  const [accountName, setAccountName] = useState(nameFromParams || getDefaultVaultName(coinCode));
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [importName, setImportName] = useState(getDefaultVaultName(coinCode));
  const [importRecoveryFile, setImportRecoveryFile] = useState<TVaultRecoveryFile>();
  const [importFileName, setImportFileName] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    if (!draft || draft.state === 'collectingSigners') {
      return;
    }
    getVaultSetupRecoveryFile(draft.id)
      .then(result => {
        if (!result.success) {
          setErrorMessage(result.errorMessage);
          return;
        }
        setRecoveryFile(result.recoveryFile);
      })
      .catch(error => {
        console.error(error);
        setErrorMessage(t('genericError'));
      });
  }, [draft, t]);

  const handleStart = async () => {
    if (!coinCode) {
      setErrorMessage(t('addAccount.vault.invalidCoin'));
      return;
    }
    setBusy(true);
    try {
      const result = await startVaultSetup(coinCode, accountName || undefined);
      if (!result.success) {
        setErrorMessage(result.errorMessage || t('genericError'));
        return;
      }
      navigate(`/add-account/vault/${result.draft.id}`);
    } catch (error) {
      console.error(error);
      setErrorMessage(t('genericError'));
    } finally {
      setBusy(false);
    }
  };

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

  const handleDownloadWalletDescriptor = () => {
    if (!recoveryFile) {
      return;
    }
    const json = JSON.stringify(recoveryFile, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${recoveryFile.network}-vault-descriptor-${recoveryFile.policyId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <GuideWrapper>
      <GuidedContent>
        <Main>
          <Header title={<h2>{t('addAccount.vault.setup', { name: accountName || t('addAccount.vault.title') })}</h2>} />
          <View fitContent width="var(--content-width-small)">
            <ViewContent>
              <div className={styles.content}>
                <Message type="warning" hidden={!errorMessage}>
                  {errorMessage}
                </Message>
                {draft ? (
                  <>
                    <p className={styles.lead}>
                      {t('addAccount.vault.progress', {
                        count: draft.participants.length,
                      })}
                    </p>
                    <div className={styles.participants}>
                      {draft.participants.map((participant, index) => (
                        <div className={styles.participant} key={`${participant.keyInfo.rootFingerprint}-${index}`}>
                          <strong>
                            {participant.name || t('addAccount.vault.signerLabel', {
                              number: index + 1,
                            })}
                          </strong>
                          <span>{participant.keyInfo.rootFingerprint}</span>
                          <code>{participant.keyInfo.keypath}</code>
                        </div>
                      ))}
                    </div>
                    {draft.state === 'collectingSigners' ? (
                      <p className={styles.description}>
                        {t('addAccount.vault.collectingDescription')}
                      </p>
                    ) : (
                      <>
                        <h3 className={styles.sectionTitle}>{t('addAccount.vault.onChainBackup')}</h3>
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
                        {recoveryFile && (
                          <>
                            <h3 className={styles.sectionTitle}>{t('addAccount.vault.walletDescriptorAdditional')}</h3>
                            <div className={styles.descriptorSection}>
                              <p className={styles.description}>
                                {t('addAccount.vault.walletDescriptorIntro')}
                              </p>
                              <Button disabled={busy} onClick={handleDownloadWalletDescriptor} secondary>
                                {t('addAccount.vault.downloadDescriptor')}
                              </Button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {mode === 'create' ? (
                      <>
                        <p className={styles.lead}>{t('addAccount.vault.policy')}</p>
                        <p className={styles.description}>
                          {t('addAccount.vault.createDescription')}
                        </p>
                      </>
                    ) : (
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
                    )}
                  </>
                )}
              </div>
            </ViewContent>
            <ViewButtons>
              {draft ? (
                <>
                  {draft.state === 'collectingSigners' ? (
                    <Button primary disabled={busy} onClick={handleEnrollSigner}>
                      {t('addAccount.vault.enrollSigner')}
                    </Button>
                  ) : (
                    <>
                      <Button primary disabled={busy || !recoveryAcknowledged} onClick={handleComplete}>
                        {t('addAccount.vault.complete')}
                      </Button>
                    </>
                  )}
                  <Button onClick={handleDiscard} secondary>
                    {t('addAccount.vault.discard')}
                  </Button>
                </>
              ) : (
                <>
                  {mode === 'create' ? (
                    <Button primary disabled={busy} onClick={handleStart}>
                      {t('addAccount.vault.create')}
                    </Button>
                  ) : (
                    <Button primary disabled={busy || !importRecoveryFile || !importName} onClick={handleImport}>
                      {t('addAccount.vault.import')}
                    </Button>
                  )}
                  <BackButton enableEsc>
                    {t('button.back')}
                  </BackButton>
                </>
              )}
            </ViewButtons>
          </View>
        </Main>
      </GuidedContent>
    </GuideWrapper>
  );
};
