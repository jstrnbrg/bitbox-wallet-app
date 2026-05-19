import style from './avatar.module.css';

type Props = { seed: string; label?: string; size?: number };

export const Avatar = ({ seed: _seed, label, size = 32 }: Props) => (
  <div
    className={style.avatar}
    style={{ width: size, height: size, fontSize: size * 0.4 }}
    aria-hidden={!label}>
    {label && <span>{label.slice(0, 1).toUpperCase()}</span>}
  </div>
);
