import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-blue-400',
        className
      )}
      {...props}
    />
  );
}

