// SPDX-License-Identifier: Apache-2.0

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/backbutton/backbutton';
import { Button } from '@/components/forms';
import { GuidedContent, GuideWrapper, Header, Main } from '@/components/layout';
import { View, ViewButtons, ViewContent } from '@/components/view/view';
import multisigGraphic from './assets/multisig-graphic.svg';
import styles from './vault-intro.module.css';

export const VaultIntro = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <GuideWrapper>
      <GuidedContent>
        <Main>
          <Header title={<h2>{t('addAccount.vault.introTitle')}</h2>} />
          <View>
            <ViewContent>
              <div className={styles.layout}>
                <div className={styles.textColumn}>
                  <p className={styles.subtitle}>{t('addAccount.vault.introSubtitle')}</p>
                  <p className={styles.description}>
                    {t('addAccount.vault.introDescription')}
                  </p>
                  <div className={styles.features}>
                    <div className={styles.feature}>
                      <div className={styles.featureIcon}>🔑</div>
                      <div>
                        <p className={styles.featureTitle}>{t('addAccount.vault.introFeature3Title')}</p>
                        <p className={styles.featureDescription}>{t('addAccount.vault.introFeature3Description')}</p>
                      </div>
                    </div>
                    <div className={styles.feature}>
                      <div className={styles.featureIcon}>🛡️</div>
                      <div>
                        <p className={styles.featureTitle}>{t('addAccount.vault.introFeature1Title')}</p>
                        <p className={styles.featureDescription}>{t('addAccount.vault.introFeature1Description')}</p>
                      </div>
                    </div>
                    <div className={styles.feature}>
                      <div className={styles.featureIcon}>🔒</div>
                      <div>
                        <p className={styles.featureTitle}>{t('addAccount.vault.introFeature2Title')}</p>
                        <p className={styles.featureDescription}>{t('addAccount.vault.introFeature2Description')}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className={styles.graphicColumn}>
                  <img src={multisigGraphic} alt="" className={styles.graphic} draggable={false} />
                </div>
              </div>
            </ViewContent>
            <ViewButtons>
              <Button primary onClick={() => navigate('/add-account?type=vault')}>
                {t('addAccount.vault.introSetupButton')}
              </Button>
              <BackButton enableEsc>
                {t('button.back')}
              </BackButton>
            </ViewButtons>
          </View>
        </Main>
      </GuidedContent>
    </GuideWrapper>
  );
};
