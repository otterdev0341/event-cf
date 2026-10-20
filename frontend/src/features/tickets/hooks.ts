import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ticketService } from './service';
import { useWorkspace } from '../../stores/workspace';
import type { Ticket } from '../../shared/contracts/tickets';
export function useTicketMove() {
  const { orgId, eventId } = useWorkspace();
  const client = useQueryClient();
  const key = ['org', orgId, eventId, 'tickets'];
  return useMutation({
    mutationFn: ({ ticket, status }: { ticket: Ticket; status: Ticket['status'] }) =>
      ticketService.update(orgId, eventId, ticket.id, { status, expectedVersion: ticket.version }),
    onMutate: async ({ ticket, status }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Ticket[]>(key);
      client.setQueryData<Ticket[]>(key, (rows) =>
        rows?.map((t) => (t.id === ticket.id ? { ...t, status } : t)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}
