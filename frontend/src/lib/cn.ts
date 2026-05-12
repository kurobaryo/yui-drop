import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn(...inputs)` — combines clsx (conditional class merging) with
 * tailwind-merge (dedupes conflicting tailwind classes). Use for any
 * conditional className prop.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
