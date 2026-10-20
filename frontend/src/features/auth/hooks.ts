import { useQuery } from '@tanstack/react-query';
import { authService } from './service';
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => authService.session(signal),
    staleTime: Infinity,
  });
}
