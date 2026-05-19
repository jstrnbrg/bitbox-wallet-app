// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import style from './demo-banner.module.css';

export const DemoBanner = () => {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) {
    return null;
  }
  return (
    <div className={style.banner} role="note">
      <span className={style.message}>{t('cloud.demoBanner.message')}</span>
      <button
        type="button"
        className={style.dismiss}
        onClick={() => setDismissed(true)}
        aria-label={t('cloud.demoBanner.dismiss')}>
        &times;
      </button>
    </div>
  );
};
