import { useEffect, useState } from 'react';
import { Button } from './ui';
export function usePage<T>(rows: T[], resetKey: string, size = 20) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => setPage(1), [resetKey]);
  const current = Math.min(page, pages);
  return {
    rows: rows.slice((current - 1) * size, current * size),
    page: current,
    pages,
    setPage,
    total: rows.length,
  };
}
export function Pagination({
  page,
  pages,
  setPage,
  total,
}: {
  page: number;
  pages: number;
  setPage: (page: number) => void;
  total: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 border-t border-line">
      <span className="eyebrow">
        {total} RECORDS · PAGE {page} / {pages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
