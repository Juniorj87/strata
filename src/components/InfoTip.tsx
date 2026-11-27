import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * Lightweight accessible disclosure tooltip for secondary explanations,
 * formulas, and safety notes that would otherwise clutter the main canvas.
 */
export function InfoTip({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      const rect = btnRef.current.getBoundingClientRect();
      const width = Math.min(310, window.innerWidth - 24);
      const left = Math.min(
        Math.max(12, rect.left + rect.width / 2 - width / 2),
        window.innerWidth - width - 12,
      );
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow >= 130 ? rect.bottom + 8 : Math.max(12, rect.top - 120);
      setPos({ top, left });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="info-tip" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={open ? 'info-tip-btn active' : 'info-tip-btn'}
        aria-label={label}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && pos && (
        <span
          id={tipId}
          role="tooltip"
          className="info-tip-pop"
          style={{ top: pos.top, left: pos.left }}
          onClick={(event) => event.stopPropagation()}
        >
          {text}
        </span>
      )}
    </span>
  );
}
