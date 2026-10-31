import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className = '' }) => {
  return (
    <nav aria-label="Fil d'Ariane" className={`flex items-center text-xs text-slate-500 ${className}`}>
      <ol className="flex items-center gap-1.5 flex-wrap">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1.5">
              {item.href && !isLast ? (
                <Link
                  to={item.href}
                  className="hover:text-indigo-600 transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span className={`font-medium ${isLast ? 'text-slate-800' : ''}`}>
                  {item.label}
                </span>
              )}
              {!isLast && (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 rtl-flip shrink-0" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
