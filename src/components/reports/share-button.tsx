'use client';

import { useState } from 'react';
import { Link as LinkIcon, Share2, Check } from 'lucide-react';

interface ShareButtonProps {
  token: string;
  title?: string;
  variant?: 'icon' | 'full';
}

export function ShareButton({ token, title = 'Relatório de Imóvel', variant = 'icon' }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    // Construct the absolute URL
    const url = `${window.location.origin}/r/${token}`;

    // Try using Web Share API if available (especially good for mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: title,
          text: 'Confira este relatório de desempenho do imóvel:',
          url: url,
        });
        return;
      } catch (err) {
        // Fallback to clipboard if share gets cancelled or fails
        console.log('Share API failed or cancelled', err);
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      alert('Não foi possível copiar o link. O link é: ' + url);
    }
  };

  if (variant === 'full') {
    return (
      <button
        onClick={handleShare}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
      >
        {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
        {copied ? 'Link Copiado!' : 'Compartilhar Relatório'}
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      className="inline-flex items-center justify-center p-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors border border-white/10"
      title="Compartilhar ou Copiar Link"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <LinkIcon className="w-4 h-4" />}
    </button>
  );
}
