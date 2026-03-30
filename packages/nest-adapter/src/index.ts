import {
  type DashboardApiOptions,
} from '@omni-queue/dashboard-api';
import { omniQueueExpressAdapter } from '@omni-queue/express-adapter';

export interface NestLikeApplication {
  use: (...args: unknown[]) => unknown;
}

export function omniQueueNestAdapter(options: DashboardApiOptions) {
  return omniQueueExpressAdapter(options);
}

export function registerNestAdapter(app: NestLikeApplication, options: DashboardApiOptions): void {
  app.use(omniQueueNestAdapter(options));
}
