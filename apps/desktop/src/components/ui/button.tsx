import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
  {
    variants: {
      variant: {
        default: 'bg-blue-500 text-white hover:bg-blue-400',
        secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700',
        outline: 'border border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800',
        danger: 'bg-rose-500 text-white hover:bg-rose-400'
      },
      size: {
        default: 'h-11 px-5',
        lg: 'h-14 px-7 text-base',
        icon: 'h-12 w-12'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

