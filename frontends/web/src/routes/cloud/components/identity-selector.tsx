// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCloud } from '../state/context';
import { Avatar } from './avatar';
import style from './identity-selector.module.css';

export const IdentitySelector = () => {
  const { t } = useTranslation();
  const { identities, currentIdentity, setCurrentIdentityId } = useCloud();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const select = (id: string) => {
    setCurrentIdentityId(id);
    setOpen(false);
  };

  return (
    <div className={style.selector} ref={ref}>
      <button
        type="button"
        className={style.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('cloud.identitySelector.label')}
        onClick={() => setOpen(o => !o)}>
        <Avatar seed={currentIdentity.avatarSeed} label={currentIdentity.name} size={28} />
        <span className={style.identityInfo}>
          <span className={style.name}>{currentIdentity.name}</span>
          <span className={style.handle}>{currentIdentity.handle}</span>
        </span>
        <span className={[style.chevron, open ? style.chevronOpen : ''].filter(Boolean).join(' ')}>&#9662;</span>
      </button>
      {open && (
        <ul className={style.menu} role="menu">
          {identities.map(identity => (
            <li key={identity.id}>
              <button
                type="button"
                role="menuitem"
                className={[style.menuItem, identity.id === currentIdentity.id ? style.menuItemActive : ''].filter(Boolean).join(' ')}
                onClick={() => select(identity.id)}>
                <Avatar seed={identity.avatarSeed} label={identity.name} size={28} />
                <span className={style.identityInfo}>
                  <span className={style.name}>{identity.name}</span>
                  <span className={style.handle}>{identity.handle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
