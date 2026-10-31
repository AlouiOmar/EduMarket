import React, { useState } from 'react';

export interface AvatarProps {
  src?: string;
  alt: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  size = 'md',
  className = '',
}) => {
  const [hasError, setHasError] = useState(false);

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
    xl: 'w-20 h-20 text-xl font-bold',
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden bg-slate-200 text-slate-700 font-medium shrink-0 border border-slate-200 select-none ${sizeClasses[size]} ${className}`}
    >
      {src && !hasError ? (
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setHasError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{getInitials(alt)}</span>
      )}
    </div>
  );
};
