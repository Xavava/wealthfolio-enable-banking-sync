import { Button, Input } from '@wealthfolio/ui';
import { Check, Copy } from 'lucide-react';
import { useState, type SelectHTMLAttributes } from 'react';

/**
 * Native <select> styled like Wealthfolio inputs. Used instead of the Base UI
 * Select so long lists (banks) stay simple and keyboard friendly in the sandbox.
 */
export function NativeSelect({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The add-on sandbox may not grant clipboard access; fall back to execCommand.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Read-only field with a copy button; selects the text when copying is blocked. */
export function CopyField({ value }: { value: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            const ok = await copyText(value);
            setStatus(ok ? 'copied' : 'manual');
            if (ok) setTimeout(() => setStatus('idle'), 2000);
          }}
        >
          {status === 'copied' ? <Check className="size-4" /> : <Copy className="size-4" />}
          {status === 'copied' ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      {status === 'manual' && (
        <p className="text-muted-foreground text-xs">
          No se pudo copiar automáticamente: haz clic en el campo y pulsa Ctrl+C (⌘+C en Mac).
        </p>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('es-ES', { dateStyle: 'medium' });
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Error desconocido';
}
