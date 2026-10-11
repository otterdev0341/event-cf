import { botnoiFetch } from "./client";
import type { AccountProfile } from "./types";

export async function getAccount(): Promise<AccountProfile> {
  return botnoiFetch<AccountProfile>("/me");
}
