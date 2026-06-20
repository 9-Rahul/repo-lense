"use client";

import { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function DeleteRepoButton({ repositoryId }: { repositoryId: string }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    
    if (!confirm('Are you sure you want to delete this repository? This will remove all indexed files and cannot be undone.')) {
      return;
    }

    setIsDeleting(true);
    
    try {
      const res = await fetch(`/api/repo/${repositoryId}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete');
      
      router.refresh();
      if (window.location.pathname.includes(`/repo/${repositoryId}`)) {
        router.push('/');
      }
    } catch (error) {
      console.error(error);
      alert("Failed to delete repository.");
      setIsDeleting(false);
    }
  };

  return (
    <button 
      onClick={handleDelete}
      disabled={isDeleting}
      className="p-2 text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex items-center justify-center shrink-0"
      title="Delete Repository"
    >
      {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
    </button>
  );
}
