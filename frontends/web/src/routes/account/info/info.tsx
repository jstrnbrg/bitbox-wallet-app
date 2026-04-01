// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSync } from '@/hooks/api';
import {
  TAccount,
  AccountCode,
  TStatus,
  TVaultInscriptionStatus,
  getStatus,
  exportAccount,
  exportVaultRecoveryFile,
  getTransactionList,
  getVaultInscriptionStatus,
  TTransactions,
  TVaultRecoveryFile,
} from '@/api/account';
import { findAccount } from '@/routes/account/utils';
import { TDevices } from '@/api/devices';
import { Header, Main } from '@/components/layout';
import { View, ViewContent } from '@/components/view/view';
import { ContentWrapper } from '@/components/contentwrapper/contentwrapper';
import { GlobalBanners } from '@/components/banners';
import { MobileHeader } from '@/routes/settings/components/mobile-header';
import { BackButton } from '@/components/backbutton/backbutton';
import { ActionableItem } from '@/components/actionable-item/actionable-item';
import { QRCodeLight, QRCodeDark, OutlinedUploadDark, OutlinedUploadLight } from '@/components/icon';
import { A } from '@/components/anchor/anchor';
import { Button } from '@/components/forms';
import { CopyableInput } from '@/components/copy/Copy';
import { QRCode } from '@/components/qrcode/qrcode';
import { Dialog } from '@/components/dialog/dialog';
import { useDarkmode } from '@/hooks/darkmode';
import { alertUser } from '@/components/alert/Alert';
import { statusChanged } from '@/api/accountsync';
import style from './info.module.css';

type TProps = {
  accounts: TAccount[];
  code: AccountCode;
  devices: TDevices;
};

export const Info = ({
  accounts,
  code,
  devices,
}: TProps) => {
  const { t } = useTranslation();
  const { isDarkMode } = useDarkmode();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<TTransactions>();
  const [vaultRecoveryFile, setVaultRecoveryFile] = useState<TVaultRecoveryFile>();
  const [inscriptionStatus, setInscriptionStatus] = useState<TVaultInscriptionStatus>();
  const status: TStatus | undefined = useSync(
    () => getStatus(code),
    cb => statusChanged(code, cb),
  );

  useEffect(() => {
    getTransactionList(code)
      .then(setTransactions)
      .catch(console.error);
  }, [code]);

  useEffect(() => {
    if (accounts.find(a => a.code === code)?.accountType !== 'vault') {
      return;
    }
    getVaultInscriptionStatus(code)
      .then(result => {
        if (result.success) {
          setInscriptionStatus(result);
        }
      })
      .catch(console.error);
  }, [accounts, code]);

  const hasTransactions = transactions?.success && transactions.list.length > 0;

  const account = findAccount(accounts, code);
  if (!account) {
    return null;
  }

  const handleExport = async () => {
    if (status === undefined || status.fatalError) {
      return;
    }
    try {
      const exportedResult = await exportAccount(code);
      if (exportedResult !== null && !exportedResult.success) {
        alertUser(exportedResult.errorMessage);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleExportVaultRecovery = async () => {
    try {
      const recoveryFile = await exportVaultRecoveryFile(code);
      setVaultRecoveryFile(recoveryFile);
    } catch (error) {
      console.error(error);
      alertUser(t('genericError'));
    }
  };

  const downloadRecoveryFile = () => {
    if (!vaultRecoveryFile) {
      return;
    }
    const blob = new Blob([JSON.stringify(vaultRecoveryFile, null, 2)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${vaultRecoveryFile.network}-vault-recovery-${vaultRecoveryFile.policyId}.json`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const recoveryJSON = vaultRecoveryFile ? JSON.stringify(vaultRecoveryFile, null, 2) : '';

  return (
    <Main>
      <ContentWrapper>
        <GlobalBanners devices={devices} />
      </ContentWrapper>
      <Header hideSidebarToggler title={
        <>
          <h2 className="hide-on-small">{t('accountInfo.title')}</h2>
          <MobileHeader onClick={() => navigate(-1)} title={t('accountInfo.title')} />
        </>
      } />
      <View fullscreen={false}>
        <ViewContent>
          <div className={style.menuList}>
            <ActionableItem
              onClick={handleExport}
              disabled={!hasTransactions}
            >
              <div className={style.actionItem}>
                {isDarkMode ? <OutlinedUploadLight className={style.actionIcon} aria-hidden alt="" /> : <OutlinedUploadDark className={style.actionIcon} aria-hidden alt="" />}
                <span>{t('accountInfo.exportTransactions')}</span>
              </div>
            </ActionableItem>
            <ActionableItem
              onClick={
                account.accountType === 'vault'
                  ? handleExportVaultRecovery
                  : () => navigate(`/account/${code}/info/xpub-detail`)
              }
            >
              <div className={style.actionItem}>
                {isDarkMode ? <QRCodeLight className={style.actionIcon} aria-hidden alt="" /> : <QRCodeDark className={style.actionIcon} aria-hidden alt="" />}
                <span>{account.accountType === 'vault'
                  ? t('accountInfo.exportRecoveryFile')
                  : t('accountInfo.viewAccountDetails')}</span>
              </div>
            </ActionableItem>
          </div>
          {account.accountType === 'vault' && (
            <>
              <div className={`${style.detailCard || ''} m-top-default`}>
                <div className={style.address}>
                  <div className={style.details}>
                    <div className={style.entry}>
                      <strong>{t('accountInfo.vaultType')}:</strong>
                      <span>{t('accountInfo.vaultPolicy')}</span>
                    </div>
                    <div className={style.entry}>
                      <strong>{t('accountInfo.policyId')}:</strong>
                      <code>{account.policyId}</code>
                    </div>
                    {(account.participants || []).map((participant, index) => (
                      <div className={`${style.entry || ''} ${style.largeEntry || ''}`} key={`${participant.rootFingerprint}-${index}`}>
                        <strong>
                          {participant.name || t('accountInfo.participant', { number: index + 1 })}
                        </strong>
                        <code>{participant.rootFingerprint}</code>
                        <code>{participant.keypath}</code>
                        <CopyableInput
                          alignLeft
                          flexibleHeight
                          value={participant.xpub}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className={`${style.detailCard || ''} m-top-default`}>
                <div className={style.address}>
                  <div className={style.details}>
                    <div className={style.entry}>
                      <strong>{t('accountInfo.descriptorBackup')}</strong>
                    </div>
                    {inscriptionStatus === undefined ? (
                      <div className={style.entry}>
                        <span>{t('loading')}</span>
                      </div>
                    ) : inscriptionStatus.exists ? (
                      <>
                        <div className={style.entry}>
                          <span>{inscriptionStatus.confirmed
                            ? t('accountInfo.descriptorBackupFound')
                            : t('accountInfo.descriptorBackupPending')
                          }</span>
                        </div>
                        {inscriptionStatus.txId && (
                          <div className={style.entry}>
                            <strong>{t('accountInfo.backupTx')}:</strong>
                            <A href={`${account.blockExplorerTxPrefix}${inscriptionStatus.txId}`}>
                              {inscriptionStatus.txId}
                            </A>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className={style.entry}>
                        <span>{t('accountInfo.descriptorBackupNotFound')}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          <div className={`${style.footerButtons || ''} hide-on-small`}>
            <BackButton enableEsc>
              {t('button.back')}
            </BackButton>
          </div>
        </ViewContent>
      </View>
      <Dialog
        open={!!vaultRecoveryFile}
        medium
        onClose={() => setVaultRecoveryFile(undefined)}
        title={t('accountInfo.exportRecoveryFile')}>
        {vaultRecoveryFile && (
          <>
            <QRCode data={JSON.stringify(vaultRecoveryFile)} size={220} />
            <div className="m-top-half m-bottom-half">
              <CopyableInput
                alignLeft
                flexibleHeight
                value={recoveryJSON}
                displayValue={recoveryJSON}
              />
            </div>
            <Button primary onClick={downloadRecoveryFile}>
              {t('button.download')}
            </Button>
          </>
        )}
      </Dialog>
    </Main>
  );
};
