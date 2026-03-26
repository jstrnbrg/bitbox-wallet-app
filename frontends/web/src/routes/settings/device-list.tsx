// SPDX-License-Identifier: Apache-2.0

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import type { TPlatformName } from '@/api/devices';
import { getDeviceInfo } from '@/api/bitbox02';
import { GuideWrapper, GuidedContent, Header, Main } from '@/components/layout';
import { ContentWrapper } from '@/components/contentwrapper/contentwrapper';
import { View, ViewContent } from '@/components/view/view';
import { GlobalBanners } from '@/components/banners';
import { MobileHeader } from '@/routes/settings/components/mobile-header';
import { WithSettingsTabs } from '@/routes/settings/components/tabs';
import { ManageDeviceGuide } from '@/routes/device/bitbox02/settings-guide';
import { SettingsItem } from './components/settingsItem/settingsItem';
import { TPagePropsWithSettingsTabs } from './types';

const platformLabel = (platform: TPlatformName): string => {
  switch (platform) {
  case 'bitbox02':
    return 'BitBox02';
  case 'bitbox02-bootloader':
    return 'BitBox02 (Bootloader)';
  case 'bitbox':
    return 'BitBox';
  default:
    return 'Unknown';
  }
};

type TDeviceEntry = {
  id: string;
  platform: TPlatformName;
  name?: string;
};

export const DeviceList = ({ devices, hasAccounts }: TPagePropsWithSettingsTabs) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const deviceIDs = Object.keys(devices);
  const [deviceEntries, setDeviceEntries] = useState<TDeviceEntry[]>([]);

  useEffect(() => {
    const entries: TDeviceEntry[] = [];
    for (const id of deviceIDs) {
      const platform = devices[id];
      if (platform) {
        entries.push({ id, platform });
      }
    }

    // Fetch device names for BitBox02 devices.
    const fetchNames = async () => {
      const updated = await Promise.all(
        entries.map(async (entry) => {
          if (entry.platform === 'bitbox02') {
            try {
              const result = await getDeviceInfo(entry.id);
              if ('deviceInfo' in result && result.deviceInfo) {
                return { ...entry, name: result.deviceInfo.name };
              }
            } catch {
              // ignore, fall through to default label
            }
          }
          return entry;
        })
      );
      setDeviceEntries(updated);
    };

    fetchNames();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(deviceIDs)]);

  // If only one device is connected, redirect directly to its settings.
  useEffect(() => {
    if (deviceIDs.length === 1 && deviceIDs[0]) {
      navigate(`/settings/device-settings/${deviceIDs[0]}`, { replace: true });
    }
  }, [deviceIDs, navigate]);

  return (
    <Main>
      <GuideWrapper>
        <GuidedContent>
          <ContentWrapper>
            <GlobalBanners devices={devices} />
          </ContentWrapper>
          <Header
            hideSidebarToggler
            title={
              <>
                <h2 className="hide-on-small">{t('sidebar.settings')}</h2>
                <MobileHeader withGuide title={t('sidebar.devices')} />
              </>
            }/>
          <View fullscreen={false}>
            <ViewContent>
              <WithSettingsTabs
                devices={devices}
                hideMobileMenu
                hasAccounts={hasAccounts}
              >
                {deviceEntries.map(entry => (
                  <SettingsItem
                    key={entry.id}
                    settingName={entry.name || platformLabel(entry.platform)}
                    secondaryText={entry.name ? platformLabel(entry.platform) : undefined}
                    onClick={() => navigate(`/settings/device-settings/${entry.id}`)}
                  />
                ))}
              </WithSettingsTabs>
            </ViewContent>
          </View>
        </GuidedContent>
        <ManageDeviceGuide />
      </GuideWrapper>
    </Main>
  );
};
