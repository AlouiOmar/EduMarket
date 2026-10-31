import React from 'react';
import { Star } from 'lucide-react';

export interface RatingProps {
  score: number;
  max?: number;
  count?: number;
  size?: 'sm' | 'md';
  showScore?: boolean;
}

export const Rating: React.FC<RatingProps> = ({
  score,
  max = 5,
  count,
  size = 'sm',
  showScore = true,
}) => {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <div className="inline-flex items-center gap-1.5 text-amber-500">
      <div className="flex items-center">
        {Array.from({ length: max }).map((_, index) => {
          const filled = index + 1 <= Math.round(score);
          return (
            <Star
              key={index}
              className={`${iconSize} ${
                filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300 fill-slate-100'
              }`}
            />
          );
        })}
      </div>
      {showScore && (
        <span className="text-xs font-semibold text-slate-700 tabular-nums">
          {score.toFixed(1)}
        </span>
      )}
      {count !== undefined && (
        <span className="text-xs text-slate-400 tabular-nums">
          ({count})
        </span>
      )}
    </div>
  );
};
