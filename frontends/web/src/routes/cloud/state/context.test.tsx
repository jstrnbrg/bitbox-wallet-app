import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CloudMockProvider, useCloud } from './context';

const wrapper = ({ children }: { children: ReactNode }) => (
  <CloudMockProvider>{children}</CloudMockProvider>
);

describe('CloudMockProvider', () => {
  it('starts with Personal selected and exposes its contacts', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    expect(result.current.currentIdentity.name).toBe('Personal');
    expect(result.current.contacts.length).toBe(6);
  });

  it('switching identity scopes selectors to that identity', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    act(() => result.current.setCurrentIdentityId('i-family'));
    expect(result.current.currentIdentity.name).toBe('Family Savings');
    expect(result.current.contacts.every(c => c.identityId === 'i-family')).toBe(true);
  });

  it('sendMessage appends a "me" message to the contact thread', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    const before = result.current.messages('c-alice').length;
    act(() => result.current.sendMessage('c-alice', 'hi'));
    const after = result.current.messages('c-alice');
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ from: 'me', body: 'hi' });
  });

  it('markRequestPaid flips the status', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    act(() => result.current.markRequestPaid('r-bob'));
    expect(result.current.requests.find(r => r.id === 'r-bob')?.status).toBe('paid');
  });

  it('createDoc adds a draft scoped to the current identity', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    let newId = '';
    act(() => {
      newId = result.current.createDoc({ title: 'T', body: 'B' });
    });
    const doc = result.current.docs.find(d => d.id === newId);
    expect(doc).toBeDefined();
    expect(doc!.identityId).toBe('i-personal');
    expect(doc!.recipients).toEqual([]);
  });
});
