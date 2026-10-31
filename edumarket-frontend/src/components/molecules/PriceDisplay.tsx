import React from 'react';
import { useTranslation } from 'react-i18next';

export interface PriceDisplayProps {
  price: number;
  discountPrice?: number;
  isFree?: boolean;
  currency?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const PriceDisplay: React.FC<PriceDisplayProps> = ({
  price,
  discountPrice,
  isFree = false,
  currency = '€',
  size = 'md',
}) => {
  const { t } = useTranslation();
  if (isFree || price === 0) {
    return (
      <span className="font-bold text-emerald-600 text-sm uppercase tracking-wide">
        {t('chromeUi.free')}
      </span>
    );
  }

  const hasDiscount = discountPrice !== undefined && discountPrice < price;

  const sizeClasses = {
    sm: 'text-sm font-semibold',
    md: 'text-lg font-bold',
    lg: 'text-2xl font-extrabold',
  };

  return (
    <div className="inline-flex items-baseline gap-2">
      <span className={`text-slate-900 tabular-nums ${sizeClasses[size]}`}>
        {hasDiscount ? discountPrice : price} {currency}
      </span>
      {hasDiscount && (
        <span className="text-xs text-slate-400 line-through tabular-nums">
          {price} {currency}
        </span>
      )}
    </div>
  );
};
