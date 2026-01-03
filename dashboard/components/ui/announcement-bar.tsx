'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface Promotion {
  id: string;
  message: string;
  code?: string;
  link?: string;
  linkText?: string;
  expiresAt: Date;
  bgClass?: string;
}

// Configure active promotions here
const PROMOTIONS: Promotion[] = [
  {
    id: 'black-friday-2024',
    message: 'Black Friday Deal: Use',
    code: 'CONTEXT50',
    linkText: 'at checkout for 50% off your first 3 months',
    link: '/dashboard/pricing',
    expiresAt: new Date('2025-12-01T00:00:00Z'),
    bgClass: 'bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 dark:from-zinc-100 dark:via-zinc-200 dark:to-zinc-100',
  },
];

function getActivePromotion(): Promotion | null {
  const now = new Date();
  return PROMOTIONS.find(p => p.expiresAt > now) || null;
}

export function AnnouncementBar() {
  const [isVisible, setIsVisible] = useState(false);
  const [promotion, setPromotion] = useState<Promotion | null>(null);

  useEffect(() => {
    const promo = getActivePromotion();
    if (!promo) return;

    // Check if user has dismissed this promotion
    const dismissedPromos = JSON.parse(localStorage.getItem('dismissed-promos') || '[]');
    if (dismissedPromos.includes(promo.id)) return;

    setPromotion(promo);
    setIsVisible(true);
  }, []);

  const handleDismiss = () => {
    if (!promotion) return;

    const dismissedPromos = JSON.parse(localStorage.getItem('dismissed-promos') || '[]');
    dismissedPromos.push(promotion.id);
    localStorage.setItem('dismissed-promos', JSON.stringify(dismissedPromos));
    setIsVisible(false);
  };

  const copyCode = () => {
    if (promotion?.code) {
      navigator.clipboard.writeText(promotion.code);
    }
  };

  if (!isVisible || !promotion) return null;

  return (
    <div className={`relative ${promotion.bgClass || 'bg-zinc-900 dark:bg-zinc-100'} text-white dark:text-zinc-900 py-2.5 px-4 pr-10`}>
      {/* Mobile: Condensed single line */}
      <div className="sm:hidden flex items-center justify-center gap-2 text-sm font-medium">
        <span>Black Friday:</span>
        {promotion.code && (
          <button
            onClick={copyCode}
            className="inline-flex items-center bg-white/20 dark:bg-black/10 px-2 py-0.5 rounded font-mono font-bold"
            title="Click to copy"
          >
            {promotion.code}
          </button>
        )}
        <span>50% off</span>
        {promotion.link && (
          <a href={promotion.link} className="underline font-semibold">
            →
          </a>
        )}
      </div>

      {/* Desktop: Full message */}
      <div className="hidden sm:flex max-w-7xl mx-auto items-center justify-center gap-2 text-sm font-medium">
        <span>{promotion.message}</span>
        {promotion.code && (
          <button
            onClick={copyCode}
            className="inline-flex items-center gap-1 bg-white/20 dark:bg-black/10 hover:bg-white/30 dark:hover:bg-black/20 px-2 py-0.5 rounded font-mono font-bold transition-colors"
            title="Click to copy"
          >
            {promotion.code}
          </button>
        )}
        {promotion.linkText && (
          <span>{promotion.linkText}</span>
        )}
        {promotion.link && (
          <a
            href={promotion.link}
            className="underline underline-offset-2 hover:no-underline font-semibold ml-1"
          >
            Get started →
          </a>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-white/20 dark:hover:bg-black/10 rounded transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
