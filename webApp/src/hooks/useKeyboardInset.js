/**
 * iOS keyboard inset from the visual viewport (px to pad bottom of sheets).
 */
import { useEffect, useState } from 'react';

export const useKeyboardInset = () => {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;

    const update = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(Math.round(keyboard));
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', update);
    };
  }, []);

  return inset;
};
