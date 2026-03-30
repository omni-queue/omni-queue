import {
  startDashboardServer,
  type StandaloneDashboardServerOptions,
} from '@omni-queue/dashboard-api';

export function startHonoAdapter(options: StandaloneDashboardServerOptions) {
  return startDashboardServer(options);
}
