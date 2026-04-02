import path from 'node:path';
import { omniQueueNextAdapter } from '@omni-queue/next-adapter';
import { ensureSupervisorStarted, supervisor } from '../../../src/runtime';

export default async function handler(req: unknown, res: unknown) {
  await ensureSupervisorStarted();
  return omniQueueNextAdapter({
    supervisor,
    apiBase: '/api/omni-queue',
    uiDir: path.resolve(process.cwd(), 'public/omni-queue-dashboard'),
    protectUiWithAuth: false,
  })(req as never, res as never);
}
