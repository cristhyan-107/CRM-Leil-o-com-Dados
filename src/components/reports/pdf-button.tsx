'use client';

import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';

interface PdfButtonProps {
  /** CSS selector or ref ID of the element to capture */
  targetSelector?: string;
  /** Filename for the downloaded PDF (without .pdf extension) */
  filename?: string;
  variant?: 'icon' | 'full';
}

export function PdfButton({ 
  targetSelector = '#report-content', 
  filename = 'relatorio',
  variant = 'icon' 
}: PdfButtonProps) {
  const [generating, setGenerating] = useState(false);

  const handleGeneratePdf = async () => {
    setGenerating(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;

      const element = document.querySelector(targetSelector);
      if (!element) {
        console.error('Report content element not found:', targetSelector);
        return;
      }

      // Clone the element so we can style it for PDF without affecting the page
      const clone = element.cloneNode(true) as HTMLElement;
      
      // Override dark-mode styles for PDF (white background for readability)
      clone.style.backgroundColor = '#ffffff';
      clone.style.color = '#1a1a1a';
      clone.style.padding = '24px';
      
      // Override CSS custom properties that use OKLCH format for safe HEX/RGB
      const safeVars = {
        '--background': '#ffffff', '--foreground': '#0f172a',
        '--card': '#ffffff', '--card-foreground': '#0f172a',
        '--popover': '#ffffff', '--popover-foreground': '#0f172a',
        '--primary': '#2563eb', '--primary-foreground': '#ffffff',
        '--secondary': '#f1f5f9', '--secondary-foreground': '#0f172a',
        '--muted': '#f8fafc', '--muted-foreground': '#64748b',
        '--accent': '#f1f5f9', '--accent-foreground': '#0f172a',
        '--destructive': '#ef4444', '--border': '#e2e8f0',
        '--input': '#e2e8f0', '--ring': '#3b82f6',
        '--chart-1': '#3b82f6', '--chart-2': '#22c55e',
        '--chart-3': '#f59e0b', '--chart-4': '#a855f7',
        '--chart-5': '#ef4444', '--sidebar': '#f8fafc',
        '--sidebar-foreground': '#0f172a', '--sidebar-primary': '#2563eb',
        '--sidebar-primary-foreground': '#ffffff', '--sidebar-accent': '#f1f5f9',
        '--sidebar-accent-foreground': '#0f172a', '--sidebar-border': '#e2e8f0',
        '--sidebar-ring': '#3b82f6',
      };
      
      Object.entries(safeVars).forEach(([key, value]) => {
        clone.style.setProperty(key, value);
      });

      // Force inline safe colors to avoid html2canvas crashing on modern CSS colors (oklch, lab)
      clone.querySelectorAll('*').forEach((el: Element) => {
        const htmlEl = el as HTMLElement;
        const computedStyle = window.getComputedStyle(htmlEl);
        
        // Check for unsupported color formats in computed styles and replace them
        const checkAndReplaceColor = (prop: any) => {
          const val = computedStyle[prop as keyof CSSStyleDeclaration] as string;
          if (val && (val.includes('oklch') || val.includes('lab') || val.includes('lch') || val.includes('color(display-p3'))) {
            // Fallbacks based on common classes or default to safe colors
            if (prop === 'color') htmlEl.style.color = '#1a1a1a';
            else if (prop === 'backgroundColor') htmlEl.style.backgroundColor = val.includes('transparent') ? 'transparent' : '#ffffff';
            else if (prop.includes('border') || prop.includes('outline')) (htmlEl.style as any)[prop] = '#e2e8f0';
            else if (prop === 'fill') htmlEl.style.fill = '#3b82f6';
            else if (prop === 'stroke') htmlEl.style.stroke = 'currentColor';
            else if (prop === 'boxShadow') htmlEl.style.boxShadow = 'none';
            else (htmlEl.style as any)[prop] = ''; // Just clear it if unknown
          }
        };

        const colorProps = [
          'color', 'backgroundColor', 'borderColor', 'borderTopColor', 
          'borderRightColor', 'borderBottomColor', 'borderLeftColor',
          'fill', 'stroke', 'outlineColor', 'boxShadow', 'textDecorationColor'
        ];
        colorProps.forEach(checkAndReplaceColor);

        // Apply white-background theme overrides mapping tailwind classes to hex
        const className = htmlEl.className || '';
        if (typeof className === 'string') {
          if (className.includes('text-white') || className.includes('text-gray-200')) htmlEl.style.color = '#1a1a1a';
          if (className.includes('text-gray-400')) htmlEl.style.color = '#4a5568';
          if (className.includes('text-blue-')) htmlEl.style.color = '#2563eb';
          if (className.includes('text-emerald-')) htmlEl.style.color = '#059669';
          if (className.includes('bg-[#') || className.includes('bg-gray-800') || className.includes('bg-gray-900')) htmlEl.style.backgroundColor = '#ffffff';
          if (className.includes('border-white') || className.includes('border-gray-800')) htmlEl.style.borderColor = '#e2e8f0';
        }
      });

      // Hide print:hidden elements
      clone.querySelectorAll('.print\\:hidden, [class*="print:hidden"]').forEach((el: Element) => {
        (el as HTMLElement).style.display = 'none';
      });

      const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename: `${filename}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { 
          scale: 2, 
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        },
        jsPDF: { 
          unit: 'mm' as const, 
          format: 'a4' as const, 
          orientation: 'portrait' as const,
        },
      };

      // Temporarily add clone to DOM (hidden)
      clone.style.position = 'absolute';
      clone.style.left = '-9999px';
      clone.style.top = '0';
      clone.style.width = '800px';
      document.body.appendChild(clone);

      await html2pdf().set(opt).from(clone).save();

      document.body.removeChild(clone);
    } catch (err) {
      console.error('Error generating PDF:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (variant === 'full') {
    return (
      <button
        onClick={handleGeneratePdf}
        disabled={generating}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white rounded-lg font-medium transition-colors print:hidden"
      >
        {generating ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <FileDown className="w-4 h-4" />
        )}
        {generating ? 'Gerando PDF...' : 'Baixar PDF'}
      </button>
    );
  }

  return (
    <button
      onClick={handleGeneratePdf}
      disabled={generating}
      className="inline-flex items-center justify-center p-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-gray-300 rounded-lg transition-colors border border-white/10 print:hidden"
      title="Baixar PDF"
    >
      {generating ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <FileDown className="w-4 h-4" />
      )}
    </button>
  );
}
