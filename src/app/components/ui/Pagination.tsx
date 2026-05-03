// ============================================================
// Shared Pagination Component
// Usage:
//   import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'
//   <Pagination meta={meta} onPageChange={setPage} />
// ============================================================

export interface PaginationMeta {
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export default function Pagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta
  onPageChange: (page: number) => void
}) {
  if (meta.totalPages <= 1) return null

  const pages = Array.from({ length: meta.totalPages }, (_, i) => i + 1)
  const showPages = pages.filter(
    (p) => p === 1 || p === meta.totalPages || Math.abs(p - meta.page) <= 1
  )

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[#0D1B3E]/8">
      <p className="text-xs text-gray-400">
        Showing{' '}
        {Math.min((meta.page - 1) * meta.pageSize + 1, meta.total)}–
        {Math.min(meta.page * meta.pageSize, meta.total)}{' '}
        of {meta.total.toLocaleString()} results
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(meta.page - 1)}
          disabled={meta.page === 1}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>

        {showPages.map((p, i) => {
          const prev = showPages[i - 1]
          const showEllipsis = prev && p - prev > 1
          return (
            <span key={p} className="flex items-center gap-1">
              {showEllipsis && (
                <span className="text-xs text-gray-400 px-1">...</span>
              )}
              <button
                onClick={() => onPageChange(p)}
                className={`text-xs w-7 h-7 rounded-lg transition-colors ${
                  meta.page === p
                    ? 'bg-[#0D1B3E] text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}
              >
                {p}
              </button>
            </span>
          )
        })}

        <button
          onClick={() => onPageChange(meta.page + 1)}
          disabled={meta.page === meta.totalPages}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  )
}