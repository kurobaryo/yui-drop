/**
 * React Query hook for the public /api/config blob.
 * Falls back to DEFAULT_CONFIG inside getConfig() so consumers never have
 * to deal with "config is undefined".
 */
import { useQuery } from '@tanstack/react-query';
import { getConfig, DEFAULT_CONFIG, type PublicConfig } from '@/lib/api/public';

export function usePublicConfig(): PublicConfig {
  const { data } = useQuery({
    queryKey: ['public-config'],
    queryFn: getConfig,
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULT_CONFIG,
  });
  return data ?? DEFAULT_CONFIG;
}
