import { create } from 'zustand';
type WorkspaceState = {
  orgId: string;
  eventId: string;
  mobileNav: boolean;
  selectOrg: (id: string) => void;
  selectEvent: (id: string) => void;
  toggleNav: () => void;
  reset: () => void;
};
export const useWorkspace = create<WorkspaceState>((set) => ({
  orgId: '',
  eventId: '',
  mobileNav: false,
  selectOrg: (orgId) => set({ orgId, eventId: '', mobileNav: false }),
  selectEvent: (eventId) => set({ eventId }),
  toggleNav: () => set((state) => ({ mobileNav: !state.mobileNav })),
  reset: () => set({ orgId: '', eventId: '', mobileNav: false }),
}));
