'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, UserRound } from 'lucide-react';

export function AccountMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      className="account-menu"
      ref={container}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true);
          item.current?.focus();
        }
        if (event.key === 'Tab') setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="profile-email account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'account-options' : undefined}
        onClick={() => setOpen((value) => !value)}
        title={email}
      >
        {email}
      </button>
      {open && (
        <div
          className="account-popover"
          id="account-options"
          role="menu"
          aria-label="Account options"
        >
          <span className="account-popover-label">YOUR ACCOUNT</span>
          <Link ref={item} href="/profile" role="menuitem" onClick={() => setOpen(false)}>
            <UserRound size={17} />
            View profile
            <ChevronRight size={15} />
          </Link>
        </div>
      )}
    </div>
  );
}
