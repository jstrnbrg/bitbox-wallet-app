// SPDX-License-Identifier: Apache-2.0

import type { LineData } from 'lightweight-charts';
import type { Slip24 } from 'request-address';
import type { TDetailStatus } from './bitsurance';
import type { SuccessResponse } from './response';
import type { NonEmptyArray } from '@/utils/types';
import { apiGet, apiPost } from '@/utils/request';

export type NativeCoinCode = 'btc' | 'tbtc' | 'rbtc' | 'ltc' | 'tltc' | 'eth' | 'sepeth';

export type AccountCode = string;

export type Fiat = 'AUD' | 'BRL' | 'BTC' | 'CAD' | 'CHF' | 'CNY' | 'CZK' | 'EUR' | 'GBP' | 'HKD' | 'ILS' | 'JPY' | 'KRW' | 'NOK' | 'NZD' | 'PLN' | 'RUB' | 'sat' | 'SEK' | 'SGD' | 'USD';

export type ConversionUnit = Fiat | 'sat';

export type NativeCoinUnit = 'BTC' | 'sat' | 'LTC' | 'ETH' | 'TBTC' | 'RBTC' | 'tsat' | 'TLTC' | 'SEPETH';

export type ERC20TokenUnit = 'USDT' | 'USDC' | 'LINK' | 'BAT' | 'MKR' | 'ZRX' | 'WBTC' | 'PAXG' | 'DAI';

export type ERC20CoinCode = 'erc20Test' | 'eth-erc20-usdt' | 'eth-erc20-usdc' | 'eth-erc20-link' | 'eth-erc20-bat' | 'eth-erc20-mkr' | 'eth-erc20-zrx' | 'eth-erc20-wbtc' | 'eth-erc20-paxg' | 'eth-erc20-dai0x6b17';

export type CoinCode = NativeCoinCode | ERC20CoinCode;

export type CoinUnit = NativeCoinUnit | ERC20TokenUnit;

export type FiatWithDisplayName = {
  currency: Fiat;
  displayName: string;
};

export type Terc20Token = {
  code: ERC20CoinCode;
  name: string;
  unit: ERC20TokenUnit;
};

export type TActiveToken = {
  tokenCode: ERC20CoinCode;
  accountCode: AccountCode;
};

export type TKeystore = {
  watchonly: boolean;
  rootFingerprint: string;
  name: string;
  lastConnected: string;
  connected: boolean;
};

export type AccountType = 'standard' | 'vault';

export type TAccountParticipant = {
  name?: string;
  rootFingerprint: string;
  keypath: string;
  xpub: string;
};

export type TAccount = {
  keystore: TKeystore;
  active: boolean;
  coinCode: CoinCode;
  coinUnit: NativeCoinUnit;
  coinName: string;
  code: AccountCode;
  name: string;
  isToken: boolean;
  contractAddress?: string;
  activeTokens?: TActiveToken[];
  blockExplorerTxPrefix: string;
  blockExplorerAddressPrefix?: string;
  bitsuranceStatus?: TDetailStatus;
  accountNumber?: number;
  accountType?: AccountType;
  policyId?: string;
  participants?: TAccountParticipant[];
  connectedSigners?: string[];
};

export const getAccounts = (): Promise<TAccount[]> => {
  return apiGet('accounts');
};

export type CoinFormattedAmount = {
  coinCode: CoinCode;
  coinName: string;
  formattedAmount: TAmountWithConversions;
};

export type TAmountsByCoin = {
  [key in CoinCode]?: TAmountWithConversions;
};

export type TKeystoreBalance = {
  fiatUnit: ConversionUnit;
  total: string;
  coinsBalance?: TAmountsByCoin;
};

export type TKeystoresBalance = {
  [rootFingerprint in TKeystore['rootFingerprint']]: TKeystoreBalance;
};

export type TAccountsBalanceSummary = {
  keystoresBalance: TKeystoresBalance;
  coinsTotalBalance: CoinFormattedAmount[];
};

export type TAccountsBalanceSummaryResponse = {
  success: true;
  accountsBalanceSummary: TAccountsBalanceSummary;
} | {
  success: false;
};

export const getAccountsBalanceSummary = (): Promise<TAccountsBalanceSummaryResponse> => {
  return apiGet('accounts/balance-summary');
};

type TEthAccountCodeAndNameByAddress = SuccessResponse & {
  code: AccountCode;
  name: string;
};

export const getEthAccountCodeAndNameByAddress = (address: string): Promise<TEthAccountCodeAndNameByAddress> => {
  return apiPost('accounts/eth-account-code', { address });
};

export type TStatus = {
  disabled: boolean;
  synced: boolean;
  fatalError: boolean;
  offlineError: string | null;
};

export const getStatus = (code: AccountCode): Promise<TStatus> => {
  return apiGet(`account/${code}/status`);
};

export type ScriptType = 'p2pkh' | 'p2wpkh-p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr';

export const allScriptTypes: ScriptType[] = ['p2pkh', 'p2wpkh-p2sh', 'p2wpkh', 'p2wsh', 'p2tr'];

type TKeyInfo = {
  keypath: string;
  rootFingerprint: string;
  xpub: string;
};

export type TBitcoinSimple = {
  keyInfo: TKeyInfo;
  scriptType: ScriptType;
};

export type TBitcoinDescriptor = {
  descriptor: string;
};

export type TEthereumSimple = {
  keyInfo: TKeyInfo;
};

export type TSigningConfiguration = {
  bitcoinSimple: TBitcoinSimple;
  bitcoinDescriptor?: never;
  ethereumSimple?: never;
} | {
  bitcoinDescriptor: TBitcoinDescriptor;
  bitcoinSimple?: never;
  ethereumSimple?: never;
} | {
  bitcoinSimple?: never;
  bitcoinDescriptor?: never;
  ethereumSimple: TEthereumSimple;
};

export type TSigningConfigurationList = null | {
  signingConfigurations: TSigningConfiguration[];
};

export const getInfo = (code: AccountCode) => {
  return (): Promise<TSigningConfigurationList> => {
    return apiGet(`account/${code}/info`);
  };
};

export const init = (code: AccountCode): Promise<null> => {
  return apiPost(`account/${code}/init`);
};

export type FormattedLineData = LineData & {
  formattedValue: string;
};

export type ChartData = FormattedLineData[];

type TChartDataResponse = {
  success: true;
  data: TChartData;
} | {
  success: false;
};

export type TChartData = {
  chartDataMissing: boolean;
  chartDataDaily: ChartData;
  chartDataHourly: ChartData;
  chartFiat: ConversionUnit;
  chartTotal: number | null;
  formattedChartTotal: string | null;
  chartIsUpToDate: boolean; // only valid if chartDataMissing is false
  lastTimestamp: number;
};

export const getChartData = (): Promise<TChartDataResponse> => {
  return apiGet('chart-data');
};

type Conversions = {
  [key in Fiat]?: string;
};

export type TAmountWithConversions = {
  amount: string;
  conversions?: Conversions;
  unit: NativeCoinUnit;
  estimated: boolean;
};

export type TBalance = {
  hasAvailable: boolean;
  available: TAmountWithConversions;
  hasIncoming: boolean;
  incoming: TAmountWithConversions;
};

type TBalanceResponse = {
  success: true;
  balance: TBalance;
} | {
  success: false;
};

export const getBalance = (code: AccountCode): Promise<TBalanceResponse> => {
  return apiGet(`account/${code}/balance`);
};

export type TTransactionStatus = 'complete' | 'pending' | 'failed';
export type TTransactionType = 'send' | 'receive' | 'send_to_self';

export type TTransaction = {
  addresses: string[];
  amount: TAmountWithConversions;
  amountAtTime: TAmountWithConversions;
  fee: TAmountWithConversions;
  feeRatePerKb: TAmountWithConversions;
  deductedAmountAtTime: TAmountWithConversions;
  gas: number;
  nonce: number | null;
  internalID: string;
  note: string;
  numConfirmations: number;
  numConfirmationsComplete: number;
  size: number;
  status: TTransactionStatus;
  time: string | null;
  type: TTransactionType;
  txID: string;
  vsize: number;
  weight: number;
};

export type TTransactions = { success: false } | { success: true; list: TTransaction[] };

type TNoteTx = {
  internalTxID: string;
  note: string;
};

export const postNotesTx = (code: AccountCode, {
  internalTxID,
  note,
}: TNoteTx): Promise<null> => {
  return apiPost(`account/${code}/notes/tx`, { internalTxID, note });
};

export const getTransactionList = (code: AccountCode): Promise<TTransactions> => {
  return apiGet(`account/${code}/transactions`);
};

export const getTransaction = (code: AccountCode, id: TTransaction['internalID']): Promise<TTransaction | null> => {
  return apiGet(`account/${code}/transaction?id=${id}`);
};

type TExport = {
  success: boolean;
  path: string;
  errorMessage: string;
};

export const exportAccount = (code: AccountCode): Promise<TExport | null> => {
  return apiPost(`account/${code}/export`);
};

export const verifyXPub = (
  code: AccountCode,
  signingConfigIndex: number,
): Promise<{ success: true } | { success: false; errorMessage: string }> => {
  return apiPost(`account/${code}/verify-extended-public-key`, { signingConfigIndex });
};

export type TReceiveAddress = {
  addressID: string;
  address: string;
};

export type TReceiveAddressList = {
  scriptType: ScriptType | null;
  addresses: NonEmptyArray<TReceiveAddress>;
};

export const getReceiveAddressList = (code: AccountCode) => {
  return (): Promise<NonEmptyArray<TReceiveAddressList> | null> => {
    return apiGet(`account/${code}/receive-addresses`);
  };
};

export type TTxInput = {
  address: string;
  amount: string;
  sendAll: 'yes' | 'no';
  selectedUTXOs: string[];
  paymentRequest: Slip24 | null;
} & (
  {
    useHighestFee: false;
    customFee: string;
    feeTarget: FeeTargetCode;
  } | {
    useHighestFee: true;
  }
);

export type TTxProposalResult = {
  amount: TAmountWithConversions;
  fee: TAmountWithConversions;
  success: true;
  total: TAmountWithConversions;
} | {
  errorCode: string;
  success: false;
};

export const proposeTx = (
  accountCode: AccountCode,
  txInput: TTxInput,
): Promise<TTxProposalResult> => {
  return apiPost(`account/${accountCode}/tx-proposal`, txInput);
};

export type TSendTx = {
  success: true;
  txId: string;
} | {
  success: false;
  aborted: true;
} | {
  success: false;
  errorMessage: string;
  errorCode?: string;
};

export const sendTx = (
  code: AccountCode,
  txNote: string,
): Promise<TSendTx> => {
  return apiPost(`account/${code}/sendtx`, txNote);
};

export type FeeTargetCode = 'custom' | 'low' | 'economy' | 'normal' | 'high' | 'mHour' | 'mHalfHour' | 'mFastest';

export type TFeeTarget = {
  code: FeeTargetCode;
  feeRateInfo: string;
};

export type TFeeTargetList = {
  feeTargets: TFeeTarget[];
  defaultFeeTarget: FeeTargetCode;
};

export const getFeeTargetList = (code: AccountCode): Promise<TFeeTargetList> => {
  return apiGet(`account/${code}/fee-targets`);
};

export const verifyAddress = (code: AccountCode, addressID: string): Promise<boolean> => {
  return apiPost(`account/${code}/verify-address`, addressID);
};

export type TUTXO = {
  outPoint: string;
  txId: string;
  txOutput: number;
  address: string;
  amount: TAmountWithConversions;
  note: string;
  scriptType?: ScriptType;
  addressReused: boolean;
  isChange: boolean;
  headerTimestamp: string | null;
};

export const getUTXOs = (code: AccountCode): Promise<TUTXO[]> => {
  return apiGet(`account/${code}/utxos`);
};

type TSecureOutput = {
  hasSecureOutput: boolean;
  optional: boolean;
};

export const hasSecureOutput = (code: AccountCode) => {
  return (): Promise<TSecureOutput> => {
    return apiGet(`account/${code}/has-secure-output`);
  };
};

type THasPaymentRequest = {
  success: boolean;
  errorMessage?: string;
  errorCode?: 'firmwareUpgradeRequired' | 'unsupportedFeature';
};

export const hasPaymentRequest = (code: AccountCode): Promise<THasPaymentRequest> => {
  return apiGet(`account/${code}/has-payment-request`);
};

export type TAddAccount = {
  success: boolean;
  accountCode?: string;
  errorCode?: 'accountAlreadyExists' | 'accountLimitReached';
  errorMessage?: string;
};

export const addAccount = (coinCode: string, name: string, rootFingerprint: string): Promise<TAddAccount> => {
  return apiPost('account-add', {
    coinCode,
    name,
    rootFingerprint,
  });
};

export type TVaultDraftState =
  | 'collectingSigners'
  | 'readyForBackup'
  | 'awaitingOnChainBackup'
  | 'readyToComplete'
  | 'completed'
  | 'discarded';

export type TVaultDraft = {
  id: string;
  network: NativeCoinCode;
  name: string;
  accountNumber: number;
  accountKeypath: string;
  participants: Array<{
    name?: string;
    keyInfo: TKeyInfo;
  }>;
  state: TVaultDraftState;
  createdAt: string;
  updatedAt: string;
  recoveryAcknowledged: boolean;
  policyId?: string;
};

export type TVaultRecoveryFile = {
  format: string;
  network: NativeCoinCode;
  policy: string;
  descriptor: string;
  threshold: number;
  scriptType: 'p2wsh';
  policyId: string;
  accountNumber: number;
  accountKeypath: string;
  participants: Array<{
    name?: string;
    keyInfo: TKeyInfo;
  }>;
  descriptors: {
    receive: string;
    change: string;
  };
  createdAt: string;
};

type TVaultDraftResponse = {
  success: true;
  draft: TVaultDraft;
} | {
  success: false;
  errorMessage: string;
  errorCode?: string;
};

type TVaultDraftListResponse = {
  success: true;
  drafts: TVaultDraft[];
} | {
  success: false;
  errorMessage: string;
};

type TVaultRecoveryResponse = {
  success: true;
  recoveryFile: TVaultRecoveryFile;
} | {
  success: false;
  errorMessage: string;
};

export const startVaultSetup = (coinCode: NativeCoinCode, name?: string): Promise<TVaultDraftResponse> => {
  return apiPost('vault-setup/start', { coinCode, name });
};

export const getVaultSetupDrafts = (): Promise<TVaultDraftListResponse> => {
  return apiGet('vault-setup/drafts');
};

export const getVaultSetupDraft = (id: string): Promise<TVaultDraftResponse> => {
  return apiGet(`vault-setup/${id}`);
};

export const enrollVaultSetupSigner = (id: string): Promise<TVaultDraftResponse> => {
  return apiPost(`vault-setup/${id}/enroll-signer`);
};

export const getVaultSetupRecoveryFile = (id: string): Promise<TVaultRecoveryResponse> => {
  return apiGet(`vault-setup/${id}/recovery-file`);
};

export const completeVaultSetup = (
  id: string,
  name: string,
  recoveryAcknowledged: boolean,
): Promise<TAddAccount> => {
  return apiPost(`vault-setup/${id}/complete`, { name, recoveryAcknowledged });
};

export const discardVaultSetup = (id: string): Promise<{ success: boolean; errorMessage?: string }> => {
  return apiPost(`vault-setup/${id}/discard`);
};

type TVaultOnChainBackupPayloadResponse = {
  success: true;
  payload: string; // base64-encoded
} | {
  success: false;
  errorMessage: string;
};

type TVaultBeaconInfo = {
  address: string;
  pkScript: string;
};

type TVaultOnChainBackupBeaconsResponse = {
  success: true;
  beacons: TVaultBeaconInfo[];
} | {
  success: false;
  errorMessage: string;
};

export const getVaultOnChainBackupPayload = (id: string): Promise<TVaultOnChainBackupPayloadResponse> => {
  return apiGet(`vault-setup/${id}/onchain-backup-payload`);
};

export const getVaultOnChainBackupBeacons = (id: string): Promise<TVaultOnChainBackupBeaconsResponse> => {
  return apiGet(`vault-setup/${id}/onchain-backup-beacons`);
};

export const importVault = (
  recoveryFile: TVaultRecoveryFile,
  name: string,
): Promise<TAddAccount> => {
  return apiPost('vault-import', { recoveryFile, name });
};

export const exportVaultRecoveryFile = (code: AccountCode): Promise<TVaultRecoveryFile> => {
  return apiGet(`account/${code}/recovery-file`);
};

export type TVaultInscriptionStatus = {
  success: boolean;
  exists: boolean;
  confirmed: boolean;
  txId?: string;
};

export const getVaultInscriptionStatus = (code: AccountCode): Promise<TVaultInscriptionStatus> => {
  return apiGet(`account/${code}/vault-inscription-status`);
};

export type TEligibleFundingAccount = {
  code: AccountCode;
  name: string;
  balance: string;
};

type TEligibleFundingAccountsResponse = {
  success: boolean;
  accounts?: TEligibleFundingAccount[];
};

export const getEligibleFundingAccounts = (vaultCode: AccountCode): Promise<TEligibleFundingAccountsResponse> => {
  return apiGet(`fund-vault/eligible-accounts/${vaultCode}`);
};

export const getVaultOnChainBackupPayloadFromAccount = (vaultCode: AccountCode): Promise<{success: boolean; payload: string}> => {
  return apiGet(`fund-vault/onchain-backup-payload/${vaultCode}`);
};

export const getVaultOnChainBackupBeaconsFromAccount = (vaultCode: AccountCode): Promise<{success: boolean; beacons: Array<{address: string; pkScript: string}>}> => {
  return apiGet(`fund-vault/onchain-backup-beacons/${vaultCode}`);
};

export const fundVaultPropose = (
  sourceCode: AccountCode,
  vaultCode: AccountCode,
  amount: string,
  feeTarget: FeeTargetCode,
  customFee: string,
  sendAll: boolean,
): Promise<TTxProposalResult> => {
  return apiPost('fund-vault/propose', {
    sourceCode,
    vaultCode,
    amount,
    feeTarget,
    customFee,
    sendAll: sendAll ? 'yes' : 'no',
  });
};

export const fundVaultSend = (
  sourceCode: AccountCode,
  note: string,
): Promise<TSendTx> => {
  return apiPost('fund-vault/send', { sourceCode, note });
};

export type TSigningSessionState =
  | 'draft'
  | 'partiallySigned'
  | 'readyToBroadcast'
  | 'broadcasted'
  | 'abandoned';

export type TSigningSession = {
  id: string;
  state: TSigningSessionState;
  createdAt: string;
  updatedAt: string;
  recipientAddr: string;
  amount: TAmountWithConversions;
  fee: TAmountWithConversions;
  total: TAmountWithConversions;
  note: string;
  signedBy: string[];
  missingSigners: string[];
  totalRequired: number;
  txId?: string;
};

type TSigningSessionResponse = {
  success: true;
  session: TSigningSession;
} | {
  success: false;
  aborted?: boolean;
  errorMessage: string;
};

type TSigningSessionListResponse = {
  success: true;
  sessions: TSigningSession[];
} | {
  success: false;
  errorMessage: string;
};

export const createSigningSession = (
  code: AccountCode,
  note: string,
): Promise<TSigningSessionResponse> => {
  return apiPost(`account/${code}/signing-sessions`, { note });
};

export const getSigningSessions = (code: AccountCode): Promise<TSigningSessionListResponse> => {
  return apiGet(`account/${code}/signing-sessions`);
};

export const getSigningSession = (code: AccountCode, id: string): Promise<TSigningSessionResponse> => {
  return apiGet(`account/${code}/signing-sessions/${id}`);
};

export const signSigningSession = (code: AccountCode, id: string): Promise<TSigningSessionResponse> => {
  return apiPost(`account/${code}/signing-sessions/${id}/sign`);
};

export const broadcastSigningSession = (code: AccountCode, id: string): Promise<TSigningSessionResponse> => {
  return apiPost(`account/${code}/signing-sessions/${id}/broadcast`);
};

export const abandonSigningSession = (code: AccountCode, id: string): Promise<TSigningSessionResponse> => {
  return apiPost(`account/${code}/signing-sessions/${id}/abandon`);
};

export type TSignMessage = { success: false; aborted?: boolean; errorMessage?: string } | { success: true; signature: string };

export type TSignWalletConnectTx = {
  success: false;
  aborted?: boolean;
  errorMessage?: string;
} | {
  success: true;
  txHash: string;
  rawTx: string;
};

export const ethSignMessage = (code: AccountCode, message: string): Promise<TSignMessage> => {
  return apiPost(`account/${code}/eth-sign-msg`, message);
};

export const ethSignTypedMessage = (code: AccountCode, chainId: number, data: any): Promise<TSignMessage> => {
  return apiPost(`account/${code}/eth-sign-typed-msg`, { chainId, data });
};

export const ethSignWalletConnectTx = (code: AccountCode, send: boolean, chainId: number, tx: any): Promise<TSignWalletConnectTx> => {
  return apiPost(`account/${code}/eth-sign-wallet-connect-tx`, { send, chainId, tx });
};

type AddressSignResponse = {
  success: true;
  signature: string;
  address: string;
} | {
  success: false;
  errorMessage?: string;
  errorCode?: 'userAbort' | 'wrongKeystore';
};

export const signAddress = (format: ScriptType | '', msg: string, code: AccountCode): Promise<AddressSignResponse> => {
  return apiPost(`account/${code}/sign-address`, { format, msg, code });
};
