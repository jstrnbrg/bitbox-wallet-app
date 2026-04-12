// SPDX-License-Identifier: Apache-2.0

import '../../../../__mocks__/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/i18n/i18n');

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ draftId: 'draft-1' }),
    useSearchParams: () => [new URLSearchParams('')],
  };
});

vi.mock('@/api/account', () => ({
  completeVaultSetup: vi.fn(),
  confirmVaultSetupSigner: vi.fn(),
  discardVaultSetup: vi.fn(),
  enrollVaultSetupSigner: vi.fn(),
  getAccounts: vi.fn(),
  getVaultSetupDraft: vi.fn(),
  importVault: vi.fn(),
  startVaultSetup: vi.fn(),
}));

import { VaultSetup } from './vault-setup';
import type { TVaultDraft } from '@/api/account';
import { confirmVaultSetupSigner, getVaultSetupDraft } from '@/api/account';

const baseDraft = (overrides: Partial<TVaultDraft> = {}): TVaultDraft => ({
  id: 'draft-1',
  network: 'tbtc',
  name: 'Bitcoin Testnet Vault',
  accountNumber: 0,
  accountKeypath: "m/48'/1'/0'/2'",
  participants: [
    { name: 'Signer 1', keyInfo: { rootFingerprint: 'f0000001', keypath: "m/48'/1'/0'/2'", xpub: 'xpub-1' } },
    { name: 'Signer 2', keyInfo: { rootFingerprint: 'f0000002', keypath: "m/48'/1'/0'/2'", xpub: 'xpub-2' } },
    { name: 'Signer 3', keyInfo: { rootFingerprint: 'f0000003', keypath: "m/48'/1'/0'/2'", xpub: 'xpub-3' } },
  ],
  state: 'readyForDeviceConfirmation',
  createdAt: '2026-04-12T00:00:00Z',
  updatedAt: '2026-04-12T00:00:00Z',
  recoveryAcknowledged: false,
  registeredSigners: [],
  ...overrides,
});

describe('routes/account/add/vault-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows confirm buttons and keeps continue disabled before all signers are confirmed', async () => {
    vi.mocked(getVaultSetupDraft).mockResolvedValue({
      success: true,
      draft: baseDraft({ registeredSigners: ['f0000001'] }),
    });

    render(<VaultSetup />, { wrapper: MemoryRouter });

    await waitFor(() => expect(getVaultSetupDraft).toHaveBeenCalledWith('draft-1'));

    expect(screen.getAllByRole('button', { name: 'Confirm on device' })).toHaveLength(2);
    expect(screen.getByText('Confirmed on device')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('enables continue when all signers are confirmed', async () => {
    vi.mocked(getVaultSetupDraft).mockResolvedValue({
      success: true,
      draft: baseDraft({
        state: 'readyForBackup',
        registeredSigners: ['f0000001', 'f0000002', 'f0000003'],
      }),
    });

    render(<VaultSetup />, { wrapper: MemoryRouter });

    await waitFor(() => expect(getVaultSetupDraft).toHaveBeenCalledWith('draft-1'));

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('updates the row state after confirming a signer', async () => {
    vi.mocked(getVaultSetupDraft).mockResolvedValue({
      success: true,
      draft: baseDraft(),
    });
    vi.mocked(confirmVaultSetupSigner).mockResolvedValue({
      success: true,
      draft: baseDraft({ registeredSigners: ['f0000001'] }),
    });

    render(<VaultSetup />, { wrapper: MemoryRouter });

    await waitFor(() => expect(getVaultSetupDraft).toHaveBeenCalledWith('draft-1'));

    const [firstConfirmButton] = screen.getAllByRole('button', { name: 'Confirm on device' });
    fireEvent.click(firstConfirmButton!);

    await waitFor(() => expect(confirmVaultSetupSigner).toHaveBeenCalledWith('draft-1', 'f0000001'));
    expect(screen.getByText('Confirmed on device')).toBeInTheDocument();
  });
});
