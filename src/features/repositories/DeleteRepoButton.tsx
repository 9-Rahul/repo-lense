"use client";

import { useState, useEffect } from 'react';
import { Trash2, Loader2, AlertTriangle, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function DeleteRepoButton({ repositoryId }: { repositoryId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting]);

  const handleOpenModal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    setIsOpen(true);
  };

  const handleCloseModal = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (isDeleting) return;
    setIsOpen(false);
    setError(null);
  };

  const handleConfirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/repo/${repositoryId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete repository');
      }

      setIsOpen(false);

      if (window.location.pathname.includes(`/repo/${repositoryId}`)) {
        router.push('/');
      } else {
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong while deleting.');
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        onClick={handleOpenModal}
        disabled={isDeleting}
        className="p-2 text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex items-center justify-center shrink-0"
        title="Delete Repository"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          onClick={handleCloseModal}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-border rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 relative text-left"
          >
            <button
              onClick={handleCloseModal}
              disabled={isDeleting}
              className="absolute top-4 right-4 text-muted hover:text-foreground p-1 rounded-md transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground text-base">
                  Delete repository?
                </h3>
                <p className="text-muted text-xs leading-relaxed">
                  This will permanently delete all indexed files and vector embeddings. This action cannot be undone.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isDeleting}
                className="px-3.5 py-2 text-xs font-medium text-muted hover:text-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
