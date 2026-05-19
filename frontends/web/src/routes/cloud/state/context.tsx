import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CloudState, Contact, Message, PaymentReq, TresorDoc, Identity } from './types';
import { buildSeed } from './seed';

type CreateDocInput = { title: string; body: string };

type CloudCtx = {
  currentIdentity: Identity;
  identities: Identity[];
  setCurrentIdentityId: (id: string) => void;
  contacts: Contact[];
  docs: TresorDoc[];
  requests: PaymentReq[];
  messages: (contactId: string) => Message[];
  addContact: (c: Omit<Contact, 'id' | 'identityId' | 'pairedAt'>) => string;
  createDoc: (input: CreateDocInput) => string;
  updateDoc: (id: string, patch: Partial<Pick<TresorDoc, 'title' | 'body' | 'recipients'>>) => void;
  sendMessage: (contactId: string, body: string) => void;
  markMessageRead: (id: string) => void;
  createRequest: (input: { contactId: string; amountSats: number; memo: string }) => void;
  markRequestPaid: (id: string) => void;
  markRequestDeclined: (id: string) => void;
};

const Context = createContext<CloudCtx | null>(null);

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++counter}`;

export const CloudMockProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<CloudState>(() => buildSeed());
  const [currentIdentityId, setCurrentIdentityId] = useState<string>('i-personal');

  const currentIdentity = state.identities.find(i => i.id === currentIdentityId)!;

  const contacts = useMemo(
    () => state.contacts.filter(c => c.identityId === currentIdentityId),
    [state.contacts, currentIdentityId],
  );
  const docs = useMemo(
    () => state.docs.filter(d => d.identityId === currentIdentityId),
    [state.docs, currentIdentityId],
  );
  const requests = useMemo(
    () => state.requests.filter(r => r.identityId === currentIdentityId),
    [state.requests, currentIdentityId],
  );
  const messages = useCallback(
    (contactId: string) => state.messages
      .filter(m => m.identityId === currentIdentityId && m.contactId === contactId)
      .sort((a, b) => a.sentAt - b.sentAt),
    [state.messages, currentIdentityId],
  );

  const addContact: CloudCtx['addContact'] = useCallback((c) => {
    const id = nextId('c');
    setState(s => ({
      ...s,
      contacts: [...s.contacts, { ...c, id, identityId: currentIdentityId, pairedAt: Date.now() }],
    }));
    return id;
  }, [currentIdentityId]);

  const createDoc: CloudCtx['createDoc'] = useCallback(({ title, body }) => {
    const id = nextId('d');
    const ts = Date.now();
    setState(s => ({
      ...s,
      docs: [...s.docs, { id, identityId: currentIdentityId, title, body, createdAt: ts, updatedAt: ts, recipients: [] }],
    }));
    return id;
  }, [currentIdentityId]);

  const updateDoc: CloudCtx['updateDoc'] = useCallback((id, patch) => {
    setState(s => ({
      ...s,
      docs: s.docs.map(d => d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d),
    }));
  }, []);

  const sendMessage: CloudCtx['sendMessage'] = useCallback((contactId, body) => {
    setState(s => ({
      ...s,
      messages: [...s.messages, {
        id: nextId('m'), identityId: currentIdentityId, contactId,
        from: 'me', body, sentAt: Date.now(), readAt: Date.now(),
      }],
    }));
  }, [currentIdentityId]);

  const markMessageRead: CloudCtx['markMessageRead'] = useCallback((id) => {
    setState(s => ({
      ...s,
      messages: s.messages.map(m => m.id === id ? { ...m, readAt: Date.now() } : m),
    }));
  }, []);

  const createRequest: CloudCtx['createRequest'] = useCallback(({ contactId, amountSats, memo }) => {
    setState(s => ({
      ...s,
      requests: [...s.requests, {
        id: nextId('r'), identityId: currentIdentityId, contactId,
        direction: 'out', amountSats, memo, status: 'pending', createdAt: Date.now(),
      }],
    }));
  }, [currentIdentityId]);

  const setRequestStatus = (id: string, status: PaymentReq['status']) => {
    setState(s => ({ ...s, requests: s.requests.map(r => r.id === id ? { ...r, status } : r) }));
  };
  const markRequestPaid = useCallback((id: string) => setRequestStatus(id, 'paid'), []);
  const markRequestDeclined = useCallback((id: string) => setRequestStatus(id, 'declined'), []);

  const value: CloudCtx = {
    currentIdentity, identities: state.identities, setCurrentIdentityId,
    contacts, docs, requests, messages,
    addContact, createDoc, updateDoc,
    sendMessage, markMessageRead,
    createRequest, markRequestPaid, markRequestDeclined,
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
};

export const useCloud = () => {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error('useCloud must be used inside CloudMockProvider');
  }
  return ctx;
};
