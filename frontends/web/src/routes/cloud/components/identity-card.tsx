// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/components/dialog/dialog';
import { Check, Copy, QRCodeDark } from '@/components/icon';
import { QRCode } from '@/components/qrcode/qrcode';
import { useCloud } from '../state/context';
import style from './identity-card.module.css';

const identityPayload = (handle: string, pubkey: string) =>
  `bitbox:${handle}?pk=${pubkey}`;

export const IdentityCard = () => {
  const { t } = useTranslation();
  const { currentIdentity } = useCloud();
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const payload = identityPayload(currentIdentity.handle, currentIdentity.pubkey);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
    } catch {
      setCopied(true);
    }
  };

  return (
    <>
      <div className={style.card}>
        <div className={style.handleRow}>
          <button
            type="button"
            className={style.qrButton}
            onClick={() => setQrOpen(true)}
            aria-label={t('cloud.identityCard.showQr')}
            title={t('cloud.identityCard.showQr')}>
            <QRCodeDark />
          </button>
          <div className={style.handle}>{currentIdentity.handle}</div>
          <button
            type="button"
            className={[style.copyButton, copied ? style.copyButtonSuccess : ''].filter(Boolean).join(' ')}
            onClick={handleCopy}
            aria-label={t('cloud.identityCard.copy')}
            title={t('cloud.identityCard.copy')}>
            {copied ? <Check /> : <Copy />}
          </button>
          {copied && (
            <span className={style.copied} role="status">
              {t('cloud.identityCard.copied')}
            </span>
          )}
        </div>
      </div>
      <Dialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        small
        title={t('cloud.identityCard.qrTitle')}>
        <div className={style.qrDialog}>
          <div className={style.qr}>
            <QRCode data={payload} size={196} tapToCopy={false} />
          </div>
          <div className={style.dialogHandle}>{currentIdentity.handle}</div>
          <div className={style.privacyHint}>
            {t('cloud.identityCard.privacyHint')}
          </div>
        </div>
      </Dialog>
    </>
  );
};
