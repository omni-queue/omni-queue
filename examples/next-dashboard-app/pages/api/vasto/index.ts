import path from 'node:path';
import { vastoNextAdapter } from '@vasto-queue/next-adapter';
import { ensureSupervisorStarted, supervisor } from '../../../src/runtime';

export default async function handler(req: unknown, res: unknown) {
  await ensureSupervisorStarted();
  return vastoNextAdapter({
    supervisor,
    apiBase: '/api/vasto',
    uiDir: path.resolve(process.cwd(), 'public/vasto-dashboard'),
    protectUiWithAuth: false,
  })(req as never, res as never);
}
