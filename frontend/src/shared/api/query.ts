import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from './client';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  },
});
export function useAction<T>(action: (input: T) => Promise<unknown>, keys: readonly unknown[]) {
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const mutation = useMutation({
    mutationFn: action,
    onSuccess: async () => {
      setNotice('บันทึกเรียบร้อย');
      await client.invalidateQueries({ queryKey: keys });
    },
    onError: async (error) => {
      setNotice('');
      if (error instanceof ApiError && error.status === 409) {
        await client.invalidateQueries({ queryKey: keys });
      }
    },
  });
  return { ...mutation, notice, clearNotice: () => setNotice('') };
}
