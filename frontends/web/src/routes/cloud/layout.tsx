// SPDX-License-Identifier: Apache-2.0

import { Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TAccount } from '@/api/account';
import { Header, Main } from '@/components/layout';
import { CloudMockProvider } from './state/context';
import { DemoBanner } from './components/demo-banner';

const titleKey = (pathname: string) => {
  if (pathname.startsWith('/cloud/contacts/add')) {
    return 'cloud.contacts.add.title';
  }
  if (pathname.startsWith('/cloud/contacts')) {
    return 'cloud.contacts.title';
  }
  if (pathname.startsWith('/cloud/notifications')) {
    return 'cloud.notifications.title';
  }
  if (pathname.startsWith('/cloud/tresor')) {
    return 'cloud.tresor.title';
  }
  return 'cloud.title';
};

export type TCloudOutletContext = {
  accounts: TAccount[];
};

type TProps = {
  accounts: TAccount[];
};

export const CloudLayout = ({ accounts }: TProps) => {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  return (
    <CloudMockProvider>
      <Main>
        <DemoBanner />
        <Header title={<h2>{t(titleKey(pathname))}</h2>} />
        <Outlet context={{ accounts } satisfies TCloudOutletContext} />
      </Main>
    </CloudMockProvider>
  );
};
