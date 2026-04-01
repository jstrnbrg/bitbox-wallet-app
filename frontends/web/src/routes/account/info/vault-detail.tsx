// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  TAccount,
  AccountCode,
  TVaultInscriptionStatus,
  TVaultRecoveryFile,
  exportVaultRecoveryFile,
  getVaultInscriptionStatus,
} from '@/api/account';
import { findAccount } from '@/routes/account/utils';
import { Header, Main } from '@/components/layout';
import { View, ViewContent } from '@/components/view/view';
import { MobileHeader } from '@/routes/settings/components/mobile-header';
import { BackButton } from '@/components/backbutton/backbutton';
import { Badge } from '@/components/badge/badge';
import { USBSuccess } from '@/components/icon';
import { A } from '@/components/anchor/anchor';
import { Button } from '@/components/forms';
import { CopyableInput } from '@/components/copy/Copy';
import { QRCode } from '@/components/qrcode/qrcode';
import { Dialog } from '@/components/dialog/dialog';
import { alertUser } from '@/components/alert/Alert';
import style from './info.module.css';

type TProps = {
  accounts: TAccount[];
  code: AccountCode;
};

export const VaultDetail = ({
  accounts,
  code,
}: TProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [inscriptionStatus, setInscriptionStatus] = useState<TVaultInscriptionStatus>();
  const [vaultRecoveryFile, setVaultRecoveryFile] = useState<TVaultRecoveryFile>();

  const account = findAccount(accounts, code);

  useEffect(() => {
    if (!account || account.accountType !== 'vault') {
      return;
    }
    getVaultInscriptionStatus(code)
      .then(result => {
        if (result.success) {
          setInscriptionStatus(result);
        }
      })
      .catch(console.error);
  }, [account, code]);

  if (!account || account.accountType !== 'vault') {
    return null;
  }

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
      <Header hideSidebarToggler title={
        <>
          <h2 className="hide-on-small">{t('accountInfo.accountDetails')}</h2>
          <MobileHeader onClick={() => navigate(-1)} title={t('accountInfo.accountDetails')} />
        </>
      } />
      <View fullscreen={false}>
        <ViewContent>
          <div className={`${style.detailCard || ''}`}>
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
                {(account.participants || []).map((participant, index) => {
                  const isConnected = account.connectedSigners?.includes(participant.rootFingerprint);
                  return (
                    <div className={`${style.entry || ''} ${style.largeEntry || ''}`} key={`${participant.rootFingerprint}-${index}`}>
                      <strong>
                        {participant.name || t('accountInfo.participant', { number: index + 1 })}
                        {' '}
                        {isConnected && (
                          <Badge
                            icon={props => (
                              <USBSuccess style={{
                                width: 'min(0.9rem, 12px)',
                                height: 'min(0.9rem, 12px)',
                              }} {...props} />
                            )}
                            type="success">
                            {t('device.keystoreConnected')}
                          </Badge>
                        )}
                      </strong>
                      <code>{participant.rootFingerprint}</code>
                      <code>{participant.keypath}</code>
                      <CopyableInput
                        alignLeft
                        flexibleHeight
                        value={participant.xpub}
                      />
                    </div>
                  );
                })}
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
                <div className={style.entry}>
                  <Button primary onClick={handleExportVaultRecovery}>
                    {t('accountInfo.downloadDescriptorFile')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
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
        title={t('accountInfo.downloadDescriptorFile')}>
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
