import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureSupervisorStarted, supervisor } from '../../../src/runtime';
import { NextEmailJob } from '../../../src/jobs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await ensureSupervisorStarted();

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { to, subject, body } = req.body ?? {};
  if (!to || !subject || !body) {
    res.status(400).json({ error: 'Expected payload: { to, subject, body }' });
    return;
  }

  const jobId = await supervisor.jobManager.dispatch(new NextEmailJob({ to, subject, body }));
  res.status(202).json({ status: 'queued', jobId });
}
