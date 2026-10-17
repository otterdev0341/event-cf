export function scheduledTime(date: string, time: string): string | null;
export function scheduleLabel(value: string): string;
export function activeSchedule(job: {status?: string} | null | undefined): boolean;
export type ScheduleRule = {date:string;time:string;recurrence:'once'|'daily'|'weekly';weekdays?:number[]};
export function nextScheduleTime(after: string | number, recurrence:string, time:string, weekdays?:number[]): string | null;
export function firstScheduleTime(rule:ScheduleRule, now?:number): string | null;
