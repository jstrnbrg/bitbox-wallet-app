import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar } from './avatar';

describe('Avatar', () => {
  it('renders the label initial', () => {
    const { container } = render(<Avatar seed="alice" label="Alice" />);
    expect(container).toHaveTextContent('A');
  });

  it('uses the requested size', () => {
    const { container } = render(<Avatar seed="alice" label="Alice" size={48} />);
    expect(container.firstElementChild).toHaveStyle({ width: '48px', height: '48px' });
  });
});
