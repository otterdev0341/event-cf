import { botnoiFetch } from "./client";
import type { DashboardOverviewResponse } from "./types";

export interface DashboardOverviewParams {
  startAt: string;
  endAt: string;
  agentId?: string;
  timezone?: string;
  granularity?: "day" | "hour";
}

export async function getDashboardOverview(
  params: DashboardOverviewParams,
): Promise<DashboardOverviewResponse> {
  const query = new URLSearchParams({
    start_at: params.startAt,
    end_at: params.endAt,
  });

  if (params.timezone) query.set("timezone", params.timezone);

  if (params.agentId) {
    query.set("agent_id", params.agentId);
  }
  if (params.granularity) {
    query.set("granularity", params.granularity);
  }

  return botnoiFetch<DashboardOverviewResponse>(
    `/dashboard/v1/overview?${query.toString()}`,
  );
}
