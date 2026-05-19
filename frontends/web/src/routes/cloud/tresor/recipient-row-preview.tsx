// SPDX-License-Identifier: Apache-2.0

import { useCloud } from '../state/context';
import { Avatar } from '../components/avatar';
import type { TresorRecipient } from '../state/types';
import style from './list.module.css';

type Props = {
  recipients: TresorRecipient[];
  max?: number;
};

export const RecipientRowPreview = ({ recipients, max = 4 }: Props) => {
  const { contacts } = useCloud();
  if (recipients.length === 0) {
    return null;
  }
  const visible = recipients.slice(0, max);
  const extra = recipients.length - visible.length;
  return (
    <div className={style.avatarCluster} aria-hidden="true">
      {visible.map(r => {
        const c = contacts.find(x => x.id === r.contactId);
        if (!c) {
          return null;
        }
        return (
          <div key={r.contactId} className={style.avatarClusterItem}>
            <Avatar seed={c.handle} label={c.name} size={24} />
          </div>
        );
      })}
      {extra > 0 && <div className={style.avatarClusterMore}>+{extra}</div>}
    </div>
  );
};
