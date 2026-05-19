export type Identity = {
  id: string;
  name: string;
  handle: string;
  pubkey: string;
  avatarSeed: string;
};

export type Contact = {
  id: string;
  identityId: string;
  name: string;
  handle: string;
  pubkey: string;
  kind: 'device' | 'person';
  pairedAt: number;
};

export type TresorRecipient = {
  contactId: string;
  unlockDelayDays: number | null;
  releasedAt?: number;
};

export type TresorDoc = {
  id: string;
  identityId: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  recipients: TresorRecipient[];
};

export type Message = {
  id: string;
  identityId: string;
  contactId: string;
  from: 'me' | 'them';
  body: string;
  sentAt: number;
  readAt?: number;
};

export type PaymentReq = {
  id: string;
  identityId: string;
  contactId: string;
  direction: 'in' | 'out';
  amountSats: number;
  memo: string;
  status: 'pending' | 'paid' | 'declined';
  createdAt: number;
};

export type CloudState = {
  identities: Identity[];
  contacts: Contact[];
  docs: TresorDoc[];
  messages: Message[];
  requests: PaymentReq[];
};
