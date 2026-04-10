// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TCoin, TCoinKeystore, getSupportedCoins } from '@/api/backend';
import { subscribeKeystores } from '@/api/keystores';
import { addAccount, CoinCode, TAddAccount, TAccount } from '@/api/account';
import { SimpleMarkup } from '@/utils/markup';
import { View, ViewButtons, ViewContent, ViewHeader } from '@/components/view/view';
import { Message } from '@/components/message/message';
import { Button, Input, Radio, Select } from '@/components/forms';
import { GuidedContent, GuideWrapper, Header, Main } from '@/components/layout';
import { Step, Steps } from '@/components/steps/steps';
import { CoinDropDown } from '@/components/dropdown/coin-dropdown';
import { SubTitle } from '@/components/title';
import { useMediaQuery } from '@/hooks/mediaquery';
import { UseBackButton } from '@/hooks/backbutton';
import { AddAccountGuide } from './add-account-guide';
import { Skeleton } from '@/components/skeleton/skeleton';
import styles from './add-account.module.css';

type TStep = 'loading' | 'select-coin' | 'select-account-type' | 'choose-keystore' | 'choose-name' | 'success';
type TAccountTypeSelection = 'standard' | 'vault';

type TAddAccountContentProps = {
  accountName: string;
  accountType: TAccountTypeSelection;
  coinCode: CoinCode | 'choose';
  handleBack: () => void;
  onAccountTypeChange: (accountType: TAccountTypeSelection) => void;
  onAccountNameInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCoinChange: (coin: TCoin) => void;
  onKeystoreChange: (rootFingerprint: string) => void;
  selectedCoin?: TCoin;
  selectedRootFingerprint: string;
  step: TStep;
  standardKeystores: TCoinKeystore[];
  supportedCoins: TCoin[];
};

const AddAccountSteps = ({
  accountName,
  accountType,
  coinCode,
  handleBack,
  onAccountTypeChange,
  onAccountNameInput,
  onCoinChange,
  onKeystoreChange,
  selectedCoin,
  selectedRootFingerprint,
  step,
  standardKeystores,
  supportedCoins,
}: TAddAccountContentProps) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'choose-name') {
      inputRef.current?.focus();
    }
  }, [step]);

  switch (step) {
  case 'loading':
    return (
      <Skeleton fontSize="4rem" />
    );
  case 'select-coin':
    if (supportedCoins.length === 0) {
      return (
        <Message type="info">
          {t('connectKeystore.promptNoName')}
        </Message>
      );
    }
    return (
      <CoinDropDown
        onChange={onCoinChange}
        supportedCoins={supportedCoins}
        value={coinCode} />
    );
  case 'select-account-type':
    return (
      <div className={styles.content}>
        <UseBackButton handler={() => {
          handleBack();
          return false;
        }} />
        <div className={styles.accountTypeOptions}>
          <Radio
            checked={accountType === 'standard'}
            id="account-type-standard"
            name="account-type"
            onChange={() => onAccountTypeChange('standard')}
            title={t('addAccount.selectAccountType.standard.title')}>
            <strong>{t('addAccount.selectAccountType.standard.title')}</strong>
            <span className={styles.accountTypeDescription}>
              {t('addAccount.selectAccountType.standard.description', {
                coinName: selectedCoin?.name ?? '',
              })}
            </span>
          </Radio>
          <Radio
            checked={accountType === 'vault'}
            id="account-type-vault"
            name="account-type"
            onChange={() => onAccountTypeChange('vault')}
            title={t('addAccount.selectAccountType.vault.title')}>
            <strong>{t('addAccount.selectAccountType.vault.title')}</strong>
            <span className={styles.accountTypeDescription}>
              {t('addAccount.selectAccountType.vault.description')}
            </span>
          </Radio>
        </div>
      </div>
    );
  case 'choose-keystore':
    return (
      <>
        <UseBackButton handler={() => {
          handleBack();
          return false;
        }} />
        <Select
          id="keystore"
          label={t('addAccount.chooseKeystore.label')}
          onChange={event => onKeystoreChange(event.target.value)}
          options={standardKeystores.map(({ keystoreName, rootFingerprint }) => ({
            text: keystoreName && keystoreName !== rootFingerprint ?
              `${keystoreName} (${rootFingerprint})` :
              rootFingerprint,
            value: rootFingerprint,
          }))}
          value={selectedRootFingerprint}
        />
      </>
    );
  case 'choose-name':
    return (
      <>
        <UseBackButton handler={() => {
          handleBack();
          return false;
        }} />
        <Input
          autoFocus
          ref={inputRef}
          id="accountName"
          onInput={onAccountNameInput}
          value={accountName} />
      </>
    );
  case 'success':
    return (
      <SimpleMarkup
        className={styles.successMessage}
        markup={t('addAccount.success.message', { accountName })}
        tagName="p" />
    );
  }
};

type TAddAccountProps = {
  accounts: TAccount[];
};

export const AddAccount = ({ accounts }: TAddAccountProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedType = searchParams.get('type') as TAccountTypeSelection | null;
  const [accountCode, setAccountCode] = useState<string>();
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<TAccountTypeSelection>(preselectedType || 'standard');
  const [coinCode, setCoinCode] = useState<'choose' | CoinCode>('choose');
  const [selectedRootFingerprint, setSelectedRootFingerprint] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [step, setStep] = useState<TStep>('select-coin');
  const [supportedCoins, setSupportedCoins] = useState<TCoin[]>([]);
  const [adding, setAdding] = useState(false);

  const selectedCoin = supportedCoins.find(({ coinCode: supportedCoinCode }) => supportedCoinCode === coinCode);

  const getAddableStandardKeystores = useCallback((coin?: TCoin): TCoinKeystore[] => {
    return coin?.keystores.filter(({ canAddAccount }) => canAddAccount) || [];
  }, []);

  const getSuggestedAccountName = useCallback((coin?: TCoin, rootFingerprint?: string): string => {
    if (rootFingerprint) {
      return coin?.keystores.find(keystore => keystore.rootFingerprint === rootFingerprint)?.suggestedAccountName || '';
    }
    return coin?.suggestedAccountName || '';
  }, []);

  const getDefaultRootFingerprint = useCallback((coin?: TCoin): string => {
    return getAddableStandardKeystores(coin)[0]?.rootFingerprint || '';
  }, [getAddableStandardKeystores]);

  const onlyOneSupportedCoin = (): boolean => {
    return supportedCoins.length === 1;
  };

  const requiresAccountTypeSelection = useCallback((coin?: TCoin): boolean => {
    return !!coin?.accountTypes.includes('vault');
  }, []);

  const nextStepAfterCoinSelection = useCallback((coin?: TCoin): TStep => {
    if (requiresAccountTypeSelection(coin)) {
      return 'select-account-type';
    }
    if (getAddableStandardKeystores(coin).length > 1) {
      return 'choose-keystore';
    }
    return 'choose-name';
  }, [getAddableStandardKeystores, requiresAccountTypeSelection]);

  const startProcess = useCallback(async () => {
    try {
      setStep('loading');
      const coins = await getSupportedCoins();
      setSupportedCoins(coins);

      // When vault is preselected via URL param, find the first BTC coin and skip to name.
      if (preselectedType === 'vault') {
        const btcCoin = coins.find(c => c.accountTypes.includes('vault'));
        if (btcCoin) {
          const defaultRootFingerprint = getDefaultRootFingerprint(btcCoin);
          setCoinCode(btcCoin.coinCode);
          setSelectedRootFingerprint(defaultRootFingerprint);
          setAccountName(getSuggestedAccountName(btcCoin, defaultRootFingerprint));
          setAccountType('vault');
          setStep('choose-name');
          return;
        }
      }

      const onlyOneCoinIsSupported = (coins.length === 1);
      const firstCoin = coins[0];
      if (!firstCoin) {
        setCoinCode('choose');
        setAccountName('');
        setSelectedRootFingerprint('');
        setStep('select-coin');
        return;
      }
      setCoinCode(onlyOneCoinIsSupported ? firstCoin.coinCode : 'choose');
      setAccountType('standard');
      setSelectedRootFingerprint(onlyOneCoinIsSupported ? getDefaultRootFingerprint(firstCoin) : '');
      setStep(onlyOneCoinIsSupported ? nextStepAfterCoinSelection(firstCoin) : 'select-coin');
      if (onlyOneCoinIsSupported) {
        setAccountName(getSuggestedAccountName(firstCoin, getDefaultRootFingerprint(firstCoin)));
      }
    } catch (err) {
      console.error(err);
    }
  }, [getDefaultRootFingerprint, getSuggestedAccountName, nextStepAfterCoinSelection, preselectedType]);

  useEffect(() => {
    startProcess();

    const unsubscribe = subscribeKeystores(() => {
      startProcess();
    });
    return unsubscribe;
  }, [startProcess]);

  const back = () => {
    switch (step) {
    case 'loading':
    case 'select-coin':
      navigate(-1);
      break;
    case 'select-account-type':
      if (onlyOneSupportedCoin()) {
        navigate(-1);
      } else {
        setStep('select-coin');
        setErrorMessage(undefined);
      }
      break;
    case 'choose-keystore':
      if (requiresAccountTypeSelection(selectedCoin)) {
        setStep('select-account-type');
      } else if (onlyOneSupportedCoin()) {
        navigate(-1);
      } else {
        setStep('select-coin');
        setErrorMessage(undefined);
      }
      break;
    case 'choose-name':
      if (accountType === 'standard' && getAddableStandardKeystores(selectedCoin).length > 1) {
        setStep('choose-keystore');
      } else if (requiresAccountTypeSelection(selectedCoin)) {
        setStep('select-account-type');
      } else if (onlyOneSupportedCoin()) {
        navigate(-1);
      } else {
        setStep('select-coin');
        setErrorMessage(undefined);
      }
      break;
    case 'success':
      setStep('choose-name');
      break;
    }
  };

  const next = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    switch (step) {
    case 'select-coin':
      setStep(nextStepAfterCoinSelection(selectedCoin));
      break;
    case 'select-account-type':
      if (accountType === 'standard' && getAddableStandardKeystores(selectedCoin).length > 1) {
        setStep('choose-keystore');
      } else {
        setStep('choose-name');
      }
      break;
    case 'choose-keystore':
      setStep('choose-name');
      break;
    case 'choose-name': {
      if (accountType === 'vault') {
        navigate(`/add-account/vault?coinCode=${coinCode}&name=${encodeURIComponent(accountName)}`);
        break;
      }
      setAdding(true);
      const responseData: TAddAccount = await addAccount(coinCode, accountName, selectedRootFingerprint);
      setAdding(false);
      if (responseData.success) {
        setAccountCode(responseData.accountCode);
        setErrorMessage(undefined);
        setStep('success');
      } else if (responseData.errorCode) {
        setErrorMessage(t(`error.${responseData.errorCode}`));
      } else if (responseData.errorMessage) {
        setErrorMessage(t('unknownError', { errorMessage: responseData.errorMessage }));
      }
      break;
    }
    case 'success':
      if (accountCode) {
        navigate(`/account/${accountCode}`);
      }
      break;
    }
  };

  const getTextFor = (step: TStep) => {
    switch (step) {
    case 'loading':
      return {
        titleText: t('loading'),
        nextButtonText: t('loading'),
      };
    case 'select-coin':
      return {
        titleText: t('addAccount.selectCoin.title'),
        nextButtonText: t('addAccount.selectCoin.nextButton'),
      };
    case 'select-account-type':
      return {
        titleText: t('addAccount.selectAccountType.title'),
        nextButtonText: t('addAccount.selectAccountType.nextButton'),
      };
    case 'choose-keystore':
      return {
        titleText: t('addAccount.chooseKeystore.title'),
        nextButtonText: t('addAccount.chooseKeystore.nextButton'),
      };
    case 'choose-name':
      return {
        titleText: t('addAccount.chooseName.title'),
        nextButtonText: t('addAccount.chooseName.nextButton'),
      };
    case 'success':
      return {
        titleText: t('addAccount.success.title'),
        nextButtonText: t('addAccount.success.nextButton'),
      };
    }
  };

  const handleAddAnotherAccount = async () => {
    setAccountCode(undefined);
    setAccountName('');
    setAccountType('standard');
    setCoinCode('choose');
    setSelectedRootFingerprint('');
    setErrorMessage(undefined);
    setStep('select-coin');
    await startProcess();
  };

  const isMobile = useMediaQuery('(max-width: 768px)');
  const standardKeystores = accountType === 'standard' ? getAddableStandardKeystores(selectedCoin) : [];
  const currentStep = [
    ...(!onlyOneSupportedCoin() ? ['select-coin'] : []),
    ...(requiresAccountTypeSelection(selectedCoin) ? ['select-account-type'] : []),
    ...(accountType === 'standard' && standardKeystores.length > 1 ? ['choose-keystore'] : []),
    'choose-name',
    'success'
  ].indexOf(step);
  const { titleText, nextButtonText } = getTextFor(step);
  return (
    <Main>
      <GuideWrapper>
        <GuidedContent>
          <Header title={<h2>{t('manageAccounts.title')}</h2>} />
          <View
            fitContent
            textCenter
            verticallyCentered={!isMobile}
            width="var(--content-width-small)">
            <ViewHeader title={
              <p>{t('addAccount.title')}</p>
            }>
              <SubTitle className={styles.title}>
                {titleText}
              </SubTitle>
            </ViewHeader>
            <form
              className={styles.manageContainer}
              onSubmit={next}>
              <ViewContent
                minHeight="50px"
                textAlign="center"
                withIcon={step === 'success' ? 'success' : undefined}>
                <div className={styles.content}>
                  <Message type="warning" hidden={!errorMessage}>
                    {errorMessage}
                  </Message>
                  <AddAccountSteps
                    accountName={accountName}
                    accountType={accountType}
                    coinCode={coinCode}
                    handleBack={back}
                    onAccountTypeChange={setAccountType}
                    onAccountNameInput={e => setAccountName(e.target.value)}
                    onCoinChange={coin => {
                      const defaultRootFingerprint = getDefaultRootFingerprint(coin);
                      setCoinCode(coin.coinCode);
                      setSelectedRootFingerprint(defaultRootFingerprint);
                      setAccountName(getSuggestedAccountName(coin, defaultRootFingerprint));
                      setAccountType('standard');
                    }}
                    onKeystoreChange={rootFingerprint => {
                      const previousSuggestedName = getSuggestedAccountName(selectedCoin, selectedRootFingerprint);
                      const nextSuggestedName = getSuggestedAccountName(selectedCoin, rootFingerprint);
                      setSelectedRootFingerprint(rootFingerprint);
                      setAccountName(currentAccountName => {
                        if (!currentAccountName || currentAccountName === previousSuggestedName) {
                          return nextSuggestedName;
                        }
                        return currentAccountName;
                      });
                    }}
                    selectedCoin={selectedCoin}
                    selectedRootFingerprint={selectedRootFingerprint}
                    step={step}
                    standardKeystores={standardKeystores}
                    supportedCoins={supportedCoins} />
                </div>
                {(step !== 'success' && step !== 'loading') && (
                  <div className={step === 'select-account-type' ? styles.stepsSpacing : undefined}>
                    <Steps current={currentStep}>
                      <Step key="select-coin" hidden={onlyOneSupportedCoin()}>
                        {t('addAccount.selectCoin.step')}
                      </Step>
                      <Step
                        key="select-account-type"
                        hidden={!requiresAccountTypeSelection(selectedCoin)}>
                        {t('addAccount.selectAccountType.step')}
                      </Step>
                      <Step
                        key="choose-keystore"
                        hidden={accountType !== 'standard' || standardKeystores.length <= 1}>
                        {t('addAccount.chooseKeystore.step')}
                      </Step>
                      <Step key="choose-name">
                        {t('addAccount.chooseName.step')}
                      </Step>
                      <Step key="success">
                        {t('addAccount.success.step')}
                      </Step>
                    </Steps>
                  </div>
                )}
              </ViewContent>
              <ViewButtons>
                <Button
                  disabled={
                    step === 'loading'
                    || (step === 'select-coin' && coinCode === 'choose')
                    || (step === 'choose-keystore' && selectedRootFingerprint === '')
                    || (step === 'choose-name' && (accountName === '' || adding))
                    || (step === 'choose-name' && accountType === 'standard' && selectedRootFingerprint === '')
                  }
                  primary
                  type="submit">
                  {nextButtonText}
                </Button>
                {step === 'success' ? (
                  <Button
                    onClick={handleAddAnotherAccount}
                    secondary>
                    {t('addAccount.success.addAnotherAccount')}
                  </Button>
                ) : (
                  <Button
                    onClick={back}
                    secondary>
                    {t('button.back')}
                  </Button>
                )}
              </ViewButtons>
            </form>
          </View>
        </GuidedContent>
        <AddAccountGuide accounts={accounts} />
      </GuideWrapper>
    </Main>
  );
};
