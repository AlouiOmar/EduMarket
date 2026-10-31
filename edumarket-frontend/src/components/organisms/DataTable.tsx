import { useTranslation } from 'react-i18next';
import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { SearchField } from '../molecules/SearchField';
import { Pagination } from '../molecules/Pagination';
import { EmptyState } from '../molecules/EmptyState';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (item: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  searchFilterKey?: keyof T;
  pageSize?: number;
  emptyMessage?: string;
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  searchPlaceholder,
  searchFilterKey,
  pageSize = 8,
  emptyMessage,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);

  const filteredData = useMemo(() => {
    let result = [...data];

    if (searchTerm && searchFilterKey) {
      const q = searchTerm.toLowerCase();
      result = result.filter(item => {
        const val = item[searchFilterKey];
        return val ? String(val).toLowerCase().includes(q) : false;
      });
    }

    if (sortKey) {
      result.sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        if (aVal === bVal) return 0;
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        const comp = aVal < bVal ? -1 : 1;
        return sortDirection === 'asc' ? comp : -comp;
      });
    }

    return result;
  }, [data, searchTerm, searchFilterKey, sortKey, sortDirection]);

  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, currentPage, pageSize]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      {searchFilterKey && (
        <div className="p-4 border-b border-slate-200 max-w-sm">
          <SearchField
            value={searchTerm}
            onChange={(val) => {
              setSearchTerm(val);
              setCurrentPage(1);
            }}
            placeholder={searchPlaceholder ?? t('chromeUi.search')}
          />
        </div>
      )}

      {paginatedData.length === 0 ? (
        <div className="p-8">
          <EmptyState description={emptyMessage ?? t('chromeUi.noData')} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs text-slate-700">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold text-[11px] tracking-wider">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className="px-4 py-3.5 text-start whitespace-nowrap"
                  >
                    {col.sortable ? (
                      <button
                        onClick={() => handleSort(col.key)}
                        className="flex items-center gap-1.5 hover:text-slate-900 transition-colors uppercase"
                      >
                        <span>{col.header}</span>
                        {sortKey === col.key ? (
                          sortDirection === 'asc' ? (
                            <ChevronUp className="w-3.5 h-3.5 text-indigo-600" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-indigo-600" />
                          )
                        ) : (
                          <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedData.map((item, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-slate-50/80 transition-colors">
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3.5 whitespace-nowrap">
                      {col.render ? col.render(item) : item[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-4 bg-white border-t border-slate-200">
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
}
