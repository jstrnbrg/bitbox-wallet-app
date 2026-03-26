// SPDX-License-Identifier: Apache-2.0

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TCoin, getSupportedCoins } from '@/api/backend';
import { subscribeKeystores } from '@/api/keystores';
import { addAccount, CoinCode, TAddAccount, TAccount } from '@/api/account';
import { SimpleMarkup } from '@/utils/markup';
import { View, ViewButtons, ViewContent, ViewHeader } from '@/components/view/view';
import { Message } from '@/components/message/message';
import { Button, Input, Radio } from '@/components/forms';
import { GuidedContent, GuideWrapper, Header, Main } from '@/components/layout';
import { Step, Steps } from '@/components/steps/steps';
import { CoinDropDown } from '@/components/dropdown/coin-dropdown';
import { SubTitle } from '@/components/title';
import { useMediaQuery } from '@/hooks/mediaquery';
import { UseBackButton } from '@/hooks/backbutton';
import { AddAccountGuide } from './add-account-guide';
import { Skeleton } from '@/components/skeleton/skeleton';
import styles from './add-account.module.css';

type TStep = 'loading' | 'select-coin' | 'select-account-type' | 'choose-name' | 'success';
type TAccountTypeSelection = 'standard' | 'vault';

type TAddAccountContentProps = {
  accountName: string;
  accountType: TAccountTypeSelection;
  coinCode: CoinCode | 'choose';
  handleBack: () => void;
  onAccountTypeChange: (accountType: TAccountTypeSelection) => void;
  onAccountNameInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCoinChange: (coin: TCoin) => void;
  selectedCoin?: TCoin;
  step: TStep;
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
  selectedCoin,
  step,
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
  const [accountCode, setAccountCode] = useState<string>();
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<TAccountTypeSelection>('standard');
  const [coinCode, setCoinCode] = useState<'choose' | CoinCode>('choose');
  const [errorMessage, setErrorMessage] = useState<string>();
  const [step, setStep] = useState<TStep>('select-coin');
  const [supportedCoins, setSupportedCoins] = useState<TCoin[]>([]);
  const [adding, setAdding] = useState(false);

  const selectedCoin = supportedCoins.find(({ coinCode: supportedCoinCode }) => supportedCoinCode === coinCode);

  const onlyOneSupportedCoin = (): boolean => {
    return supportedCoins.length === 1;
  };

  const requiresAccountTypeSelection = useCallback((coin?: TCoin): boolean => {
    return !!coin?.accountTypes.includes('vault');
  }, []);

  const nextStepAfterCoinSelection = useCallback((_coin?: TCoin): TStep => {
    return 'choose-name';
  }, []);

  const startProcess = useCallback(async () => {
    try {
      setStep('loading');
      const coins = await getSupportedCoins();
      setSupportedCoins(coins);
      const onlyOneCoinIsSupported = (coins.length === 1);
      const firstCoin = coins[0];
      if (!firstCoin) {
        setCoinCode('choose');
        setAccountName('');
        setStep('select-coin');
        return;
      }
      setCoinCode(onlyOneCoinIsSupported ? firstCoin.coinCode : 'choose');
      setAccountType('standard');
      setStep(onlyOneCoinIsSupported ? nextStepAfterCoinSelection(firstCoin) : 'select-coin');
      if (onlyOneCoinIsSupported) {
        setAccountName(firstCoin.suggestedAccountName);
      }
    } catch (err) {
      console.error(err);
    }
  }, [nextStepAfterCoinSelection]);

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
    case 'choose-name':
      if (onlyOneSupportedCoin()) {
        navigate(-1);
      } else {
        setStep('select-coin');
        setErrorMessage(undefined);
      }
      break;
    case 'select-account-type':
      setStep('choose-name');
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
    case 'choose-name':
      if (requiresAccountTypeSelection(selectedCoin)) {
        setStep('select-account-type');
      } else {
        setAdding(true);
        const responseData: TAddAccount = await addAccount(coinCode, accountName);
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
      }
      break;
    case 'select-account-type':
      if (accountType === 'vault') {
        navigate(`/add-account/vault?coinCode=${coinCode}&name=${encodeURIComponent(accountName)}`);
      } else {
        setAdding(true);
        const stdResponse: TAddAccount = await addAccount(coinCode, accountName);
        setAdding(false);
        if (stdResponse.success) {
          setAccountCode(stdResponse.accountCode);
          setErrorMessage(undefined);
          setStep('success');
        } else if (stdResponse.errorCode) {
          setErrorMessage(t(`error.${stdResponse.errorCode}`));
        } else if (stdResponse.errorMessage) {
          setErrorMessage(t('unknownError', { errorMessage: stdResponse.errorMessage }));
        }
      }
      break;
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
    setErrorMessage(undefined);
    setStep('select-coin');
    await startProcess();
  };

  const currentStep = [
    ...(!onlyOneSupportedCoin() ? ['select-coin'] : []),
    'choose-name',
    ...(requiresAccountTypeSelection(selectedCoin) ? ['select-account-type'] : []),
    'success'
  ].indexOf(step);

  const isMobile = useMediaQuery('(max-width: 768px)');
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
                      setCoinCode(coin.coinCode);
                      setAccountName(coin.suggestedAccountName);
                      setAccountType('standard');
                    }}
                    selectedCoin={selectedCoin}
                    step={step}
                    supportedCoins={supportedCoins} />
                </div>
                {(step !== 'success' && step !== 'loading') && (
                  <div className={step === 'select-account-type' ? styles.stepsSpacing : undefined}>
                    <Steps current={currentStep}>
                      <Step key="select-coin" hidden={onlyOneSupportedCoin()}>
                        {t('addAccount.selectCoin.step')}
                      </Step>
                      <Step key="choose-name">
                        {t('addAccount.chooseName.step')}
                      </Step>
                      <Step
                        key="select-account-type"
                        hidden={!requiresAccountTypeSelection(selectedCoin)}>
                        {t('addAccount.selectAccountType.step')}
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
                    || (step === 'choose-name' && (accountName === '' || adding))
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
