// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import style from './feature-tile.module.css';

type Props = {
  to?: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
};

const Content = ({ title, subtitle, icon }: Omit<Props, 'to'>) => (
  <>
    <div className={style.icon}>{icon}</div>
    <div className={style.title}>{title}</div>
    <div className={style.subtitle}>{subtitle}</div>
  </>
);

export const FeatureTile = ({ to, title, subtitle, icon }: Props) => {
  if (!to) {
    return (
      <div className={[style.tile, style.tileInactive].join(' ')}>
        <Content icon={icon} title={title} subtitle={subtitle} />
      </div>
    );
  }
  return (
    <Link to={to} className={style.tile}>
      <Content icon={icon} title={title} subtitle={subtitle} />
    </Link>
  );
};
