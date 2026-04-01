// SPDX-License-Identifier: Apache-2.0

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import * as accountApi from '@/api/account';
import { statusChanged, syncAddressesCount, syncdone } from '@/api/accountsync';
import { TDevices } from '@/api/devices';
import { getMarketVendors, MarketVendors } from '@/api/market';
import { Balance } from '@/components/balance/balance';
import { HeadersSync } from '@/components/headerssync/headerssync';
import { InfoBlue, LoupeBlue, PointToBitBox02 } from '@/components/icon';
import { Column, GuidedContent, Grid, GuideWrapper, Header, Main } from '@/components/layout';
import { Spinner } from '@/components/spinner/Spinner';
import { Message } from '@/components/message/message';
import { useLoad, useSubscribe, useSync } from '@/hooks/api';
import { useBitsurance } from '@/hooks/bitsurance';
import { useDebounce } from '@/hooks/debounce';
import { HideAmountsButton } from '@/components/hideamountsbutton/hideamountsbutton';
import { alertUser } from '@/components/alert/Alert';
import { AmountWithUnit } from '@/components/amount/amount-with-unit';
import { ActionButtons } from './actionButtons';
import { Insured } from './components/insuredtag';
import { AccountGuide } from './guide';
import { BuyReceiveCTA } from './info/buy-receive-cta';
import { isBitcoinBased } from './utils';
import { MultilineMarkup } from '@/utils/markup';
import { Dialog } from '@/components/dialog/dialog';
import { A } from '@/components/anchor/anchor';
import { i18n } from '@/i18n/i18n';
import { ContentWrapper } from '@/components/contentwrapper/contentwrapper';
import { GlobalBanners } from '@/components/banners';
import { View, ViewButtons, ViewContent, ViewHeader } from '@/components/view/view';
import { TransactionList } from './components/transaction-list';
import { TransactionDetails } from '@/components/transactions/details';
import { Button, Input } from '@/components/forms';
import { SubTitle } from '@/components/title';
import { Arrow } from '@/components/transactions/components/arrows';
import { Loupe } from '@/components/icon/icon';
import { FiatValue } from '@/components/amount/fiat-value';
import { UseDisableBackButton } from '@/hooks/backbutton';
import { TransactionHistorySkeleton } from '@/routes/account/transaction-history-skeleton';
import confirmStyle from '@/routes/account/send/components/confirm/confirm.module.css';
import { TxDetailRow } from '@/components/transactions/components/tx-detail-dialog/tx-detail-row';
import { AddressOrTxId } from '@/components/transactions/components/tx-detail-dialog/address-or-tx-id';
import txStyle from '@/components/transactions/transaction.module.css';
import txDetailStyle from '@/components/transactions/components/tx-detail-dialog/tx-detail-dialog.module.css';
import { RatesContext } from '@/contexts/RatesContext';
import { OfflineError } from '@/components/banners/offline-error';
import style from './account.module.css';

type Props = {
  accounts: accountApi.TAccount[];
  code: accountApi.AccountCode;
  devices: TDevices;
};

export const Account = (props: Props) => {
  if (!props.code) {
    return null;
  }
  // The `key` prop forces a re-mount when `code` changes.
  return <RemountAccount key={props.code} {...props} />;
};

const getBitsuranceGuideLink = (
  resolvedLanguage: string | undefined,
): string => {
  switch (resolvedLanguage) {
  case 'de':
    return 'https://bitbox.swiss/redirects/bitsurance-segwit-migration-guide-de/';
  default:
    return 'https://bitbox.swiss/redirects/bitsurance-segwit-migration-guide-en/';
  }
};

// Re-mounted when `code` changes, and `code` is guaranteed to be non-empty.
const RemountAccount = ({
  accounts,
  code,
  devices,
}: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { btcUnit } = useContext(RatesContext);

  const [balance, setBalance] = useState<accountApi.TBalance>();
  const status: accountApi.TStatus | undefined = useSync(
    () => accountApi.getStatus(code),
    cb => statusChanged(code, cb),
  );
  const syncedAddressesCount = useSubscribe(syncAddressesCount(code));
  const [transactions, setTransactions] = useState<accountApi.TTransactions>();
  const [signingSessions, setSigningSessions] = useState<accountApi.TSigningSession[]>();
  const [detailID, setDetailID] = useState<accountApi.TTransaction['internalID'] | null>(null);
  const [signingSessionDetail, setSigningSessionDetail] = useState<accountApi.TSigningSession | null>(null);
  const [confirmAbandonSession, setConfirmAbandonSession] = useState<accountApi.TSigningSession | null>(null);
  const [confirmingSession, setConfirmingSession] = useState<accountApi.TSigningSession | null>(null);
  const [broadcastSuccess, setBroadcastSuccess] = useState(false);
  const [showSearchBar, setShowSearchBar] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const debouncedSearchTerm = useDebounce(searchTerm, 200);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [inscriptionExists, setInscriptionExists] = useState<boolean | undefined>(undefined);
  const [inscriptionConfirmed, setInscriptionConfirmed] = useState<boolean>(false);

  const supportedVendors = useLoad<MarketVendors>(getMarketVendors(code), [code]);

  const account = accounts && accounts.find(acct => acct.code === code);

  const loadSigningSessions = useCallback(async () => {
    if (!account || account.accountType !== 'vault') {
      setSigningSessions(undefined);
      return;
    }
    const result = await accountApi.getSigningSessions(code);
    if (result.success) {
      setSigningSessions(result.sessions);
    } else {
      setSigningSessions([]);
    }
  }, [account, code]);

  const { insured, uncoveredFunds, clearUncoveredFunds } = useBitsurance(code, account);

  const loadingTransactions = transactions?.success === undefined;
  const hasTransactions = transactions?.success && transactions.list.length > 0;

  const filteredTransactions = useMemo(() => {
    if (!transactions?.success) {
      return [];
    }

    if (!debouncedSearchTerm.trim()) {
      return transactions.list;
    }

    const searchLower = debouncedSearchTerm.toLowerCase().trim();

    return transactions.list.filter(tx => {
      const noteMatch = tx.note?.toLowerCase().includes(searchLower);
      const addressMatch = tx.addresses?.some(address =>
        address.toLowerCase().includes(searchLower)
      );
      const txIdMatch = tx.txID?.toLowerCase().includes(searchLower);

      return noteMatch || addressMatch || txIdMatch;
    });
  }, [transactions, debouncedSearchTerm]);

  const onAccountChanged = useCallback((status: accountApi.TStatus | undefined) => {
    if (status === undefined || status.fatalError) {
      return;
    }
    if (status.synced && status.offlineError === null) {
      Promise.all([
        accountApi.getBalance(code).then(
          balance => {
            if (balance.success) {
              setBalance(balance.balance);
            }
          }),
        accountApi.getTransactionList(code).then(setTransactions),
      ])
        .catch(console.error);
    } else {
      setBalance(undefined);
      setTransactions(undefined);
    }
  }, [code]);

  useEffect(() => {
    if (status !== undefined && !status.disabled && !status.synced) {
      accountApi.init(code).catch(console.error);
    }
  }, [code, status]);

  useEffect(() => {
    return syncdone(code, () => onAccountChanged(status));
  }, [code, onAccountChanged, status]);

  useEffect(() => {
    onAccountChanged(status);
  }, [btcUnit, onAccountChanged, status]);

  useEffect(() => {
    loadSigningSessions().catch(console.error);
  }, [loadSigningSessions]);

  useEffect(() => {
    if (account?.accountType !== 'vault' || !status?.synced) {
      if (account?.accountType !== 'vault') {
        setInscriptionExists(undefined);
      }
      return;
    }
    accountApi.getVaultInscriptionStatus(code).then(result => {
      if (result.success) {
        setInscriptionExists(result.exists);
        setInscriptionConfirmed(result.confirmed);
      }
    }).catch(console.error);
  }, [account?.accountType, code, status?.synced]);

  useEffect(() => {
    if (!confirmingSession) {
      return;
    }
    const session = confirmingSession;
    const action = session.state === 'readyToBroadcast' ? 'broadcast' : 'sign';
    handleSigningSessionAction(session, action).finally(() => {
      setConfirmingSession(null);
    });
  }, [confirmingSession]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showSearchBar && searchInputRef.current) {
      searchInputRef.current?.focus();
    }
  }, [showSearchBar]);

  const hasDataLoaded = balance !== undefined && transactions !== undefined;

  if (!account) {
    return null;
  }

  if (status?.fatalError) {
    return (
      <Spinner text={t('account.fatalError')} />
    );
  }

  // Status: not synced
  const notSyncedText = (status !== undefined && !status.synced && syncedAddressesCount !== undefined && syncedAddressesCount > 1) ? (
    '\n' + t('account.syncedAddressesCount', {
      count: syncedAddressesCount.toString(),
      defaultValue: 0,
    } as any)
  ) : '';

  const exchangeSupported = supportedVendors && supportedVendors.vendors.length > 0;
  const pendingSigningSessions = (signingSessions || []).filter(
    session => session.state !== 'broadcasted' && session.state !== 'abandoned',
  );

  const isAccountEmpty = balance
    && !balance.hasAvailable
    && !balance.hasIncoming
    && transactions
    && transactions.success
    && transactions.list.length === 0;

  const isVaultWithoutInscription = account.accountType === 'vault' && inscriptionExists === false;
  const isVaultPendingConfirmation = account.accountType === 'vault' && inscriptionExists === true && !inscriptionConfirmed;

  const actionButtonsProps = {
    code,
    accountDataLoaded: hasDataLoaded,
    coinCode: account.coinCode,
    canSend: balance && balance.hasAvailable && !isVaultPendingConfirmation,
    exchangeSupported: exchangeSupported && !isVaultPendingConfirmation,
    account,
    disableReceive: isVaultPendingConfirmation,
  };

  const handleContinueSigningSession = (session: accountApi.TSigningSession) => {
    // Check if any device is connected
    const connectedSigners = account?.connectedSigners || [];
    if (connectedSigners.length === 0) {
      alertUser(t('account.signingSessions.noDeviceConnected'));
      return;
    }
    // Check if the connected device has already signed
    const alreadySigned = connectedSigners.some(fp => session.signedBy.includes(fp));
    if (alreadySigned) {
      const signerName = account?.participants?.find(
        p => connectedSigners.includes(p.rootFingerprint)
      )?.name || '';
      alertUser(t('account.signingSessions.alreadySigned', { name: signerName }));
      return;
    }
    setConfirmingSession(session);
  };

  const handleSigningSessionAction = async (
    session: accountApi.TSigningSession,
    action: 'sign' | 'broadcast' | 'abandon',
  ) => {
    let response;
    switch (action) {
    case 'sign':
      response = await accountApi.signSigningSession(code, session.id);
      break;
    case 'broadcast':
      response = await accountApi.broadcastSigningSession(code, session.id);
      break;
    case 'abandon':
      response = await accountApi.abandonSigningSession(code, session.id);
      break;
    }
    if (!response.success) {
      if (!response.aborted) {
        alertUser(response.errorMessage);
      }
      return;
    }
    if (response.session?.state === 'broadcasted') {
      setBroadcastSuccess(true);
    }
    await Promise.all([
      loadSigningSessions(),
      onAccountChanged(status),
    ]);
  };

  return (
    <GuideWrapper>
      <GuidedContent>
        <Main>
          <ContentWrapper>
            <OfflineError error={status?.offlineError} />
            <GlobalBanners code={code} devices={devices} />
            <Message
              className={style.status}
              hidden={status === undefined || status.synced || !!status.offlineError}
              type="info">
              {t('account.initializing')}
              {notSyncedText}
            </Message>
          </ContentWrapper>
          <Dialog
            open={insured && uncoveredFunds.length !== 0}
            medium
            title={t('account.warning')}
            onClose={clearUncoveredFunds}>
            <MultilineMarkup tagName="p" markup={t('account.uncoveredFunds', {
              name: account.name,
              uncovered: uncoveredFunds,
            })} />
            <A href={getBitsuranceGuideLink(i18n.resolvedLanguage)}>
              {t('account.uncoveredFundsLink')}
            </A>
          </Dialog>
          <Header
            title={<h2><span>{account.name}</span>{insured && (<Insured />)}</h2>}>
            <Link
              to={`/account/${code}/info`}
              title={t('accountInfo.title')}
              className={style.accountInfoLink}>
              <InfoBlue className={style.accountIcon} />
              <span className="hide-on-small">
                {t('accountInfo.label')}
              </span>
            </Link>
            <HideAmountsButton />
          </Header>
          {status !== undefined && status.synced && hasDataLoaded && isBitcoinBased(account.coinCode) && (
            <HeadersSync coinCode={account.coinCode} />
          )}
          <View>
            <ViewHeader>
              <div className={style.balanceHeader}>
                <Balance balance={balance} />
                {!isAccountEmpty && !isVaultWithoutInscription && <ActionButtons {...actionButtonsProps} />}
              </div>
            </ViewHeader>
            <ViewContent>
              <div className={style.accountHeader}>
                {isVaultWithoutInscription && (
                  <div className={style.vaultFundCTA}>
                    <SubTitle>{t('account.vault.fundRequired.title')}</SubTitle>
                    <p>{t('account.vault.fundRequired.message')}</p>
                    <Button primary onClick={() => navigate(`/account/${code}/fund-vault`)}>
                      {t('account.vault.fundRequired.button')}
                    </Button>
                  </div>
                )}
                {!isVaultWithoutInscription && isAccountEmpty && (
                  <BuyReceiveCTA
                    account={account}
                    code={code}
                    exchangeSupported={exchangeSupported}
                    unit={balance.available.unit}
                    balanceList={[balance]}
                  />
                )}

                {transactions?.success === false ? (
                  <p className={style.errorLoadTransactions}>
                    {t('transactions.errorLoadTransactions')}
                  </p>
                ) : !isAccountEmpty && !isVaultWithoutInscription && (
                  <>
                    <div className={style.titleRow}>
                      <SubTitle className={style.titleWithButton}>
                        {t('accountSummary.transactionHistory')}
                      </SubTitle>

                      <Button
                        className={style.searchButton}
                        transparent
                        disabled={!hasTransactions}
                        onClick={() => {
                          if (showSearchBar) {
                            setShowSearchBar(false);
                            setSearchTerm('');
                          } else {
                            setShowSearchBar(true);
                          }
                        }}
                      >
                        {showSearchBar ? (
                          <>✕ {t('generic.close')}</>
                        ) : (
                          <>
                            <LoupeBlue className={style.loupe} />
                            {t('generic.searchButton')}
                          </>
                        )}
                      </Button>
                    </div>

                    <div className={`
                      ${style.searchContainer || ''}
                      ${!showSearchBar && style.searchHidden || ''}
                    `}>
                      <Input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search transactions..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.currentTarget.value)}
                      />
                    </div>
                  </>
                )}
              </div>

              {account.accountType === 'vault' && !isVaultWithoutInscription && pendingSigningSessions.map(session => (
                <section className={txStyle.tx} key={session.id}>
                  <div className={txStyle.txContent} data-tx-type="send">
                    <span className={txStyle.txIcon}>
                      <Arrow type="send" />
                    </span>
                    <span className={txStyle.txInfoColumn}>
                      <span className={txStyle.txNote}>
                        <span className={txStyle.txNoteWithAddress}>
                          <span className={txStyle.txType}>
                            {t('account.signingSessions.sending')}
                          </span>
                          {' '}
                          <span className={txStyle.addresses}>
                            {session.recipientAddr}
                          </span>
                        </span>
                      </span>
                      <span className={style.signingSessionMeta}>
                        {t('account.signingSessions.progress', {
                          count: session.signedBy.length,
                          total: session.totalRequired,
                        })}
                        {' '}
                        <a
                          href="#"
                          className={style.signingSessionContinue}
                          onClick={(e) => {
                            e.preventDefault();
                            handleContinueSigningSession(session);
                          }}>
                          {t('account.signingSessions.continue')}
                        </a>
                      </span>
                    </span>
                    <span className={txStyle.txAmountsColumn}>
                      <span className={txStyle.txAmount}>
                        <AmountWithUnit amount={session.amount} />
                      </span>
                      <FiatValue amount={session.total} />
                    </span>
                    <button
                      className={txStyle.txShowDetailBtn}
                      onClick={() => setSigningSessionDetail(session)}
                      type="button">
                      <Loupe className={txStyle.iconLoupe} />
                    </button>
                  </div>
                </section>
              ))}

              {loadingTransactions && <TransactionHistorySkeleton />}

              <TransactionList
                transactionSuccess={transactions?.success ?? false}
                filteredTransactions={filteredTransactions}
                debouncedSearchTerm={debouncedSearchTerm}
                onShowDetail={setDetailID}
              />

              <TransactionDetails
                accountCode={code}
                explorerURL={account.blockExplorerTxPrefix}
                internalID={detailID}
                onClose={() => setDetailID(null)}
              />

              {signingSessionDetail && (
                <Dialog
                  open={!!signingSessionDetail}
                  title={confirmAbandonSession
                    ? t('account.signingSessions.confirmAbandon.title')
                    : t('transaction.details.title')}
                  onClose={() => {
                    setConfirmAbandonSession(null);
                    setSigningSessionDetail(null);
                  }}
                  slim
                  medium>
                  {confirmAbandonSession ? (
                    <div className={txDetailStyle.container}>
                      <p>{t('account.signingSessions.confirmAbandon.message')}</p>
                      <div className={style.signingSessionDetailActions}>
                        <Button onClick={() => setConfirmAbandonSession(null)} secondary>
                          {t('dialog.cancel')}
                        </Button>
                        <Button onClick={() => {
                          const session = confirmAbandonSession;
                          setConfirmAbandonSession(null);
                          setSigningSessionDetail(null);
                          handleSigningSessionAction(session, 'abandon');
                        }} danger>
                          {t('account.signingSessions.confirmAbandon.confirm')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className={txDetailStyle.container}>
                      <TxDetailRow>
                        <p className={txDetailStyle.label}>{t('send.confirm.to')}</p>
                        <AddressOrTxId values={[signingSessionDetail.recipientAddr]} />
                      </TxDetailRow>
                      <TxDetailRow>
                        <p className={txDetailStyle.label}>{t('generic.send')}</p>
                        <span><AmountWithUnit amount={signingSessionDetail.amount} /></span>
                      </TxDetailRow>
                      <TxDetailRow>
                        <p className={txDetailStyle.label}>{t('transaction.fee')}</p>
                        <span><AmountWithUnit amount={signingSessionDetail.fee} /></span>
                      </TxDetailRow>
                      <TxDetailRow>
                        <p className={txDetailStyle.label}>{t('send.confirm.total')}</p>
                        <span><AmountWithUnit amount={signingSessionDetail.total} /></span>
                      </TxDetailRow>
                      <TxDetailRow>
                        <p className={txDetailStyle.label}>{t('account.signingSessions.signaturesLabel')}</p>
                        <span>
                          {t('account.signingSessions.progress', {
                            count: signingSessionDetail.signedBy.length,
                            total: signingSessionDetail.totalRequired,
                          })}
                          {signingSessionDetail.signedBy.length > 0 && account.participants && (
                            <span className={style.signingSessionSignedBy}>
                              {signingSessionDetail.signedBy.map(fp => {
                                const participant = account.participants?.find(p => p.rootFingerprint === fp);
                                return participant?.name || fp;
                              }).join(', ')}
                            </span>
                          )}
                        </span>
                      </TxDetailRow>
                      {signingSessionDetail.note && (
                        <TxDetailRow>
                          <p className={txDetailStyle.label}>{t('note.title')}</p>
                          <span>{signingSessionDetail.note}</span>
                        </TxDetailRow>
                      )}
                      <div className={style.signingSessionDetailActions}>
                        <Button onClick={() => {
                          setConfirmAbandonSession(signingSessionDetail);
                        }} secondary>
                          {t('account.signingSessions.delete')}
                        </Button>
                        <Button onClick={() => {
                          const session = signingSessionDetail;
                          setSigningSessionDetail(null);
                          handleContinueSigningSession(session);
                        }} primary>
                          {t('account.signingSessions.continue')}
                        </Button>
                      </div>
                    </div>
                  )}
                </Dialog>
              )}
            </ViewContent>
          </View>

          {broadcastSuccess && (
            <View fullscreen textCenter verticallyCentered width="520px">
              <ViewHeader />
              <ViewContent withIcon="success">
                <p>{t('send.success')}</p>
              </ViewContent>
              <ViewButtons>
                <Button primary onClick={() => {
                  setBroadcastSuccess(false);
                }}>
                  {t('button.done')}
                </Button>
              </ViewButtons>
            </View>
          )}

          {confirmingSession && (
            <View fullscreen width="840px">
              <UseDisableBackButton />
              <ViewHeader title={<div className={confirmStyle.title}>{t('send.confirm.vaultTitle')}</div>} />
              <ViewContent>
                <Message type="info">
                  {t('send.confirm.vaultInfoMessage', {
                    next: confirmingSession.signedBy.length + 1,
                    total: confirmingSession.totalRequired,
                  })}
                </Message>

                <Grid col="2">

                  <Column col="2">
                    <div className={confirmStyle.bitBoxContainer}>
                      <PointToBitBox02 />
                    </div>
                  </Column>

                  {/* Send amount */}
                  <Column col="2">
                    <span className={confirmStyle.label}>
                      {t('generic.send')}
                    </span>
                  </Column>
                  <Column className={confirmStyle.confirmItem}>
                    <span className={confirmStyle.valueOriginalLarge}>
                      <AmountWithUnit amount={confirmingSession.amount} />
                    </span>
                  </Column>
                  <Column className={confirmStyle.confirmItem}>
                    <FiatValue
                      amount={confirmingSession.amount}
                      className={confirmStyle.valueOriginalLarge}
                    />
                  </Column>

                  {/* To */}
                  <Column col="2">
                    <span className={confirmStyle.label}>
                      {t('send.confirm.to')}
                    </span>
                  </Column>
                  <Column col="2" className={confirmStyle.confirmItem}>
                    <span>{confirmingSession.recipientAddr}</span>
                  </Column>

                  {/* Note */}
                  {confirmingSession.note ? (
                    <Column col="2" className={confirmStyle.confirmItem}>
                      <span className={confirmStyle.label}>
                        {t('note.title')}
                      </span>
                      <span>{confirmingSession.note}</span>
                    </Column>
                  ) : null}

                  {/* Fee */}
                  <Column col="2">
                    <span className={confirmStyle.label}>
                      {t('send.fee.label')}
                    </span>
                  </Column>
                  <Column className={confirmStyle.confirmItem}>
                    <AmountWithUnit amount={confirmingSession.fee} />
                  </Column>
                  <Column className={confirmStyle.confirmItem}>
                    <FiatValue amount={confirmingSession.fee} />
                  </Column>

                  {/* Total */}
                  <Column col="2">
                    <span className={confirmStyle.label}>
                      {t('send.confirm.total')}
                    </span>
                  </Column>
                  <Column className={confirmStyle.valueOriginalLarge}>
                    <AmountWithUnit amount={confirmingSession.total} />
                  </Column>
                  <Column className={confirmStyle.valueOriginalLarge}>
                    <FiatValue amount={confirmingSession.total} />
                  </Column>

                  {/* Signatures */}
                  <Column col="2">
                    <span className={confirmStyle.label}>
                      {t('account.signingSessions.signaturesLabel')}
                    </span>
                  </Column>
                  <Column col="2" className={confirmStyle.confirmItem}>
                    <span>
                      {t('account.signingSessions.progress', {
                        count: confirmingSession.signedBy.length,
                        total: confirmingSession.totalRequired,
                      })}
                    </span>
                  </Column>

                </Grid>
              </ViewContent>
            </View>
          )}
        </Main>
      </GuidedContent>
      <AccountGuide
        account={account}
        unit={balance?.available.unit}
        hasIncomingBalance={balance && balance.hasIncoming}
        hasTransactions={transactions !== undefined && transactions.success && transactions.list.length > 0}
        hasNoBalance={balance && balance.available.amount === '0'}
      />
    </GuideWrapper>
  );
};
