// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as accountApi from '@/api/account';
import { syncdone } from '@/api/accountsync';
import { convertToCurrency, convertFromCurrency } from '@/api/coins';
import { connectKeystore } from '@/api/keystores';
import { BackButton } from '@/components/backbutton/backbutton';
import { Button } from '@/components/forms';
import { Column, ColumnButtons, GuidedContent, GuideWrapper, Header, Main, ResponsiveGrid } from '@/components/layout';
import { Message } from '@/components/message/message';
import { View, ViewContent } from '@/components/view/view';
import { Balance } from '@/components/balance/balance';
import { HideAmountsButton } from '@/components/hideamountsbutton/hideamountsbutton';
import { SubTitle } from '@/components/title';
import { CoinInput } from './send/components/inputs/coin-input';
import { FiatInput } from './send/components/inputs/fiat-input';
import { NoteInput } from './send/components/inputs/note-input';
import { FeeTargets } from './send/feetargets';
import { ConfirmSend } from './send/components/confirm/confirm';
import { SendResult } from './send/components/result';
import { AmountWithUnit } from '@/components/amount/amount-with-unit';
import { FiatValue } from '@/components/amount/fiat-value';
import { RatesContext } from '@/contexts/RatesContext';
import { findAccount } from '@/routes/account/utils';
import { useMountedRef } from '@/hooks/mount';
import style from './send/send.module.css';

type TProps = {
  account: accountApi.TAccount;
  activeAccounts: accountApi.TAccount[];
};

type TFundVaultWrapperProps = {
  activeAccounts: accountApi.TAccount[];
  code: accountApi.AccountCode;
};

export const FundVaultWrapper = ({ activeAccounts, code }: TFundVaultWrapperProps) => {
  const account = findAccount(activeAccounts, code);
  return account ? <FundVault account={account} activeAccounts={activeAccounts} /> : null;
};

export const FundVault = ({ account, activeAccounts }: TProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mounted = useMountedRef();
  const { defaultCurrency } = useContext(RatesContext);

  const [eligibleAccounts, setEligibleAccounts] = useState<accountApi.TEligibleFundingAccount[]>();
  const [selectedSourceCode, setSelectedSourceCode] = useState<accountApi.AccountCode>('');
  const [amount, setAmount] = useState<string>('');
  const [fiatAmount, setFiatAmount] = useState<string>('');
  const [sendAll, setSendAll] = useState<boolean>(false);
  const [feeTarget, setFeeTarget] = useState<accountApi.FeeTargetCode>();
  const [customFee, setCustomFee] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [valid, setValid] = useState<boolean>(false);
  const [isUpdatingProposal, setIsUpdatingProposal] = useState<boolean>(false);
  const [proposedFee, setProposedFee] = useState<accountApi.TAmountWithConversions>();
  const [proposedTotal, setProposedTotal] = useState<accountApi.TAmountWithConversions>();
  const [proposedAmount, setProposedAmount] = useState<accountApi.TAmountWithConversions>();
  const [sendResult, setSendResult] = useState<accountApi.TSendTx>();
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const [sourceBalance, setSourceBalance] = useState<accountApi.TBalance>();
  const lastProposal = useRef<Promise<accountApi.TTxProposalResult> | null>(null);
  const proposeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load eligible funding accounts
  useEffect(() => {
    accountApi.getEligibleFundingAccounts(account.code)
      .then(result => {
        const accounts = result.accounts || [];
        if (mounted.current && result.success) {
          setEligibleAccounts(accounts);
          if (accounts.length === 1 && accounts[0]) {
            setSelectedSourceCode(accounts[0].code);
          }
        }
      })
      .catch(console.error);
  }, [account.code, mounted]);

  // Load source account balance when selected
  useEffect(() => {
    if (!selectedSourceCode) {
      setSourceBalance(undefined);
      return;
    }
    const loadBalance = () => {
      accountApi.getBalance(selectedSourceCode).then(result => {
        if (mounted.current && result.success) {
          setSourceBalance(result.balance);
        }
      }).catch(console.error);
    };
    loadBalance();
    return syncdone(selectedSourceCode, loadBalance);
  }, [selectedSourceCode, mounted]);

  const convertToFiat = useCallback(async (amount: string) => {
    if (amount) {
      const data = await convertToCurrency({
        amount,
        coinCode: account.coinCode,
        fiatUnit: defaultCurrency,
      });
      if (data.success) {
        setFiatAmount(data.fiatAmount);
      }
    } else {
      setFiatAmount('');
    }
  }, [account.coinCode, defaultCurrency]);

  const convertFromFiat = useCallback(async (fiatAmt: string) => {
    if (fiatAmt) {
      const data = await convertFromCurrency({
        amount: fiatAmt,
        coinCode: account.coinCode,
        fiatUnit: defaultCurrency,
      });
      if (data.success) {
        setAmount(data.amount);
      }
    } else {
      setAmount('');
    }
  }, [account.coinCode, defaultCurrency]);

  // Propose transaction when inputs change
  useEffect(() => {
    setProposedTotal(undefined);
    setErrorMessage(undefined);

    if (!selectedSourceCode || feeTarget === undefined || (!sendAll && !amount) || (feeTarget === 'custom' && !customFee)) {
      setValid(false);
      return;
    }

    if (proposeTimeout.current) {
      clearTimeout(proposeTimeout.current);
    }
    setIsUpdatingProposal(true);

    proposeTimeout.current = setTimeout(async () => {
      let proposePromise;
      try {
        proposePromise = accountApi.fundVaultPropose(
          selectedSourceCode,
          account.code,
          amount,
          feeTarget!,
          customFee,
          sendAll,
        );
        lastProposal.current = proposePromise;
        const result = await proposePromise;
        if (proposePromise === lastProposal.current) {
          setValid(result.success);
          if (result.success) {
            setProposedFee(result.fee);
            setProposedAmount(result.amount);
            setProposedTotal(result.total);
            setErrorMessage(undefined);
            if (sendAll) {
              convertToFiat(result.amount.amount);
            }
          } else {
            setProposedFee(undefined);
            setProposedTotal(undefined);
          }
          setIsUpdatingProposal(false);
        }
      } catch {
        if (proposePromise === lastProposal.current) {
          setValid(false);
          setIsUpdatingProposal(false);
        }
      }
    }, 400);

    return () => {
      if (proposeTimeout.current) {
        clearTimeout(proposeTimeout.current);
      }
    };
  }, [selectedSourceCode, amount, feeTarget, customFee, sendAll, account.code, t, convertToFiat]);

  const handleSend = useCallback(async () => {
    if (!selectedSourceCode) {
      return;
    }
    setIsConfirming(true);
    try {
      // Connect the source account's keystore for signing.
      const sourceAccount = activeAccounts.find(a => a.code === selectedSourceCode);
      if (!sourceAccount) {
        return;
      }
      const connectResult = await connectKeystore(sourceAccount.keystore.rootFingerprint);
      if (!connectResult.success) {
        return;
      }
      // Send the funding tx + reveal tx via the fund-vault endpoint.
      const result = await accountApi.fundVaultSend(selectedSourceCode, note);
      setSendResult(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsConfirming(false);
    }
  }, [selectedSourceCode, activeAccounts, note]);

  const handleContinue = () => {
    setSendResult(undefined);
    navigate(`/account/${account.code}`);
  };

  const handleRetry = () => {
    setSendResult(undefined);
  };

  // Find the first standard BTC account for the "no coins" link
  const firstStandardBtcAccount = activeAccounts.find(
    a => a.coinCode === account.coinCode && a.accountType !== 'vault' && a.active
  );

  const hasEligibleAccounts = eligibleAccounts && eligibleAccounts.length > 0;
  const showSendForm = hasEligibleAccounts && selectedSourceCode;

  return (
    <GuideWrapper>
      <GuidedContent>
        <Main>
          <Header
            title={<h2>{t('account.vault.fund.title')}</h2>}
          >
            <HideAmountsButton />
          </Header>
          <View>
            <ViewContent>
              <Message type="info">
                {t('account.vault.fund.explanation')}
              </Message>

              {eligibleAccounts === undefined ? (
                <p>{t('loading')}</p>
              ) : !hasEligibleAccounts ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-default) 0' }}>
                  <p>{t('account.vault.fund.noCoins')}</p>
                  {firstStandardBtcAccount && (
                    <p>
                      <Link to={`/account/${firstStandardBtcAccount.code}/receive`}>
                        {t('account.vault.fund.noCoinsLink')}
                      </Link>
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className={style.sendHeader}>
                    {sourceBalance && (
                      <div className={style.availableBalance}>
                        <Balance balance={sourceBalance} />
                      </div>
                    )}
                    {eligibleAccounts.length === 1 ? (
                      <SubTitle className={style.subTitle}>
                        {t('account.vault.fund.fundingFrom', { name: eligibleAccounts[0]?.name })}
                      </SubTitle>
                    ) : (
                      <SubTitle className={style.subTitle}>
                        {t('account.vault.fund.sourceLabel')}
                      </SubTitle>
                    )}
                  </div>

                  {eligibleAccounts.length > 1 && (
                    <select
                      value={selectedSourceCode}
                      onChange={(e) => setSelectedSourceCode(e.target.value)}
                      style={{ width: '100%', marginBottom: 'var(--space-default)' }}>
                      <option value="">{t('account.vault.fund.selectSource')}</option>
                      {eligibleAccounts.map(acct => (
                        <option key={acct.code} value={acct.code}>{acct.name}</option>
                      ))}
                    </select>
                  )}

                  {showSendForm && (
                    <ResponsiveGrid className={style.sendForm}>
                      <Column>
                        <CoinInput
                          balance={sourceBalance}
                          onAmountChange={(amt: string) => {
                            setAmount(amt);
                            convertToFiat(amt);
                          }}
                          onSendAllChange={(sa: boolean) => {
                            setSendAll(sa);
                          }}
                          sendAll={sendAll}
                          amountError={errorMessage}
                          proposedAmount={proposedAmount}
                          amount={amount}
                          hasSelectedUTXOs={false}
                        />
                      </Column>
                      <Column>
                        <FiatInput
                          onFiatChange={(fiat: string) => {
                            setFiatAmount(fiat);
                            convertFromFiat(fiat);
                          }}
                          disabled={sendAll}
                          error={errorMessage}
                          fiatAmount={fiatAmount}
                          label={defaultCurrency}
                        />
                      </Column>
                      <Column>
                        <FeeTargets
                          accountCode={selectedSourceCode}
                          coinCode={account.coinCode}
                          disabled={!amount && !sendAll}
                          proposedFee={proposedFee}
                          customFee={customFee}
                          showCalculatingFeeLabel={isUpdatingProposal}
                          onFeeTargetChange={(ft: accountApi.FeeTargetCode) => {
                            setFeeTarget(ft);
                            setCustomFee('');
                          }}
                          onCustomFee={(cf: string) => setCustomFee(cf)}
                          error={undefined}
                        />
                      </Column>
                      <Column>
                        <NoteInput
                          note={note}
                          onNoteChange={setNote}
                        />
                        <ColumnButtons
                          className="m-top-default m-bottom-xlarge"
                          inline>
                          <Button
                            primary
                            onClick={handleSend}
                            disabled={!valid || isUpdatingProposal || isConfirming}>
                            {t('account.vault.fund.sendButton')}
                          </Button>
                          <BackButton enableEsc={!isConfirming}>
                            {t('button.back')}
                          </BackButton>
                        </ColumnButtons>
                      </Column>
                    </ResponsiveGrid>
                  )}
                </>
              )}

            <ConfirmSend
              note={note}
              hasSelectedUTXOs={false}
              isConfirming={isConfirming}
              isVault={false}
              selectedUTXOs={{}}
              coinCode={account.coinCode}
              transactionDetails={{
                selectedReceiverAccountName: account.name,
                proposedFee,
                proposedAmount,
                proposedTotal,
                customFee,
                feeTarget,
                recipientAddress: '',
              }}
            />
              {sendResult && (
                <SendResult
                  code={account.code}
                  result={sendResult}
                  onContinue={handleContinue}
                  onRetry={handleRetry}>
                  <p>
                    {proposedAmount && (
                      <AmountWithUnit
                        amount={proposedAmount}
                        alwaysShowAmounts
                        enableRotateUnit
                      />
                    )}
                    <br />
                    {(proposedAmount && proposedAmount.conversions && proposedAmount.conversions[defaultCurrency]) ? (
                      <FiatValue
                        amount={proposedAmount}
                        enableRotateUnit
                      />
                    ) : null}
                  </p>
                </SendResult>
              )}
            </ViewContent>
          </View>
        </Main>
      </GuidedContent>
    </GuideWrapper>
  );
};
