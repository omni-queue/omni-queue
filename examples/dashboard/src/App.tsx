import { useEffect, useMemo, useState } from 'react';
import { Activity, Gauge, RefreshCw, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Select } from './components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';

type QueueOverview = {
  queue: string;
  connection: string;
  configuredConcurrency: number;
  depth: number;
  deferredCount: number;
  dlqCount: number;
};

type WorkerOverview = {
  name: string;
  queues: string[];
  concurrency: number;
  isolation: string;
};

type OverviewResponse = {
  status: string;
  generatedAt: number;
  totals: { depth: number; deferred: number; dlq: number };
  queues: QueueOverview[];
  workers: {
    configured: WorkerOverview[];
    desiredScaling: Record<string, number>;
  };
};

type JobRow = {
  id: string;
  name: string;
  queue: string;
  state: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  delayUntil?: number;
  progress?: number;
};

const statusOptions = [
  { value: 'deferred', label: 'Deferred (all)' },
  { value: 'pending-deferred', label: 'Deferred (pending only)' },
  { value: 'promoted-deferred', label: 'Deferred (promoted only)' },
  { value: 'dlq', label: 'Dead Letter Queue' },
];

export function App() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [status, setStatus] = useState('dlq');
  const [queueFilter, setQueueFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = async () => {
    const response = await fetch('/dashboard/overview');
    if (!response.ok) {
      throw new Error(`Overview request failed: ${response.status}`);
    }
    const data = (await response.json()) as OverviewResponse;
    setOverview(data);
  };

  const loadJobs = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      query.set('status', status);
      query.set('limit', '100');
      if (queueFilter !== 'all') query.set('queue', queueFilter);

      const response = await fetch(`/dashboard/jobs?${query.toString()}`);
      if (!response.ok) throw new Error(`Jobs request failed: ${response.status}`);
      const payload = (await response.json()) as { jobs: JobRow[] };
      setJobs(payload.jobs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  const retryDlqJob = async (queueName: string, jobId: string) => {
    const response = await fetch('/dashboard/dlq/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queueName, jobId }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error((payload as { error?: string }).error ?? 'Retry failed');
    }
  };

  const setWorkerScale = async (workerName: string, concurrency: number) => {
    const response = await fetch('/dashboard/scaling', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workerName, concurrency }),
    });
    if (!response.ok) throw new Error(`Scaling update failed: ${response.status}`);
    await loadOverview();
  };

  useEffect(() => {
    void loadOverview();
    void loadJobs();
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [status, queueFilter]);

  useEffect(() => {
    const source = new EventSource('/dashboard/stream');
    source.addEventListener('overview', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as OverviewResponse;
        setOverview(payload);
      } catch {
        // ignore malformed events
      }
    });

    source.onerror = () => {
      source.close();
      setTimeout(() => {
        void loadOverview();
      }, 1200);
    };

    return () => {
      source.close();
    };
  }, []);

  const queueOptions = useMemo(
    () => [
      { value: 'all', label: 'All queues' },
      ...(overview?.queues ?? []).map((queue) => ({ value: queue.queue, label: queue.queue })),
    ],
    [overview]
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Omni Queue Dashboard</h1>
          <p className="text-muted-foreground">Queue overview, failed job triage, and worker scaling controls.</p>
        </div>
        <Button onClick={() => { void loadOverview(); void loadJobs(); }}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4" /> Queue Depth</CardTitle>
            <CardDescription>Total enqueued + leased jobs across queues</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{overview?.totals.depth ?? '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4" /> Deferred Jobs</CardTitle>
            <CardDescription>Jobs waiting on delay/schedule windows</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{overview?.totals.deferred ?? '—'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="h-4 w-4" /> Dead Letter Jobs</CardTitle>
            <CardDescription>Permanently failed jobs requiring triage</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{overview?.totals.dlq ?? '—'}</div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Queue Overview</CardTitle>
            <CardDescription>Health snapshot for each queue</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Queue</TableHead>
                  <TableHead>Depth</TableHead>
                  <TableHead>Deferred</TableHead>
                  <TableHead>DLQ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(overview?.queues ?? []).map((queue) => (
                  <TableRow key={queue.queue}>
                    <TableCell className="font-medium">{queue.queue}</TableCell>
                    <TableCell>{queue.depth}</TableCell>
                    <TableCell>{queue.deferredCount}</TableCell>
                    <TableCell>
                      <Badge variant={queue.dlqCount > 0 ? 'destructive' : 'secondary'}>{queue.dlqCount}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Worker Scaling Controls</CardTitle>
            <CardDescription>Set desired worker concurrency targets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(overview?.workers.configured ?? []).map((worker) => (
              <div key={worker.name} className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{worker.name}</p>
                    <p className="text-xs text-muted-foreground">queues: {worker.queues.join(', ')}</p>
                  </div>
                  <Badge variant="outline">{worker.isolation}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    defaultValue={overview?.workers.desiredScaling[worker.name] ?? worker.concurrency}
                    onBlur={(event: { currentTarget: HTMLInputElement }) => {
                      const value = Number(event.currentTarget.value);
                      if (Number.isFinite(value) && value > 0) {
                        void setWorkerScale(worker.name, Math.floor(value));
                      }
                    }}
                  />
                  <Button variant="secondary" onClick={() => void setWorkerScale(worker.name, worker.concurrency)}>
                    Reset
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Job Browser</CardTitle>
          <CardDescription>Filter deferred and dead-letter jobs, then retry failed ones.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Status</p>
              <Select value={status} onChange={setStatus} options={statusOptions} />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Queue</p>
              <Select value={queueFilter} onChange={setQueueFilter} options={queueOptions} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => void loadJobs()} disabled={loading}>
                {loading ? 'Loading…' : 'Reload Jobs'}
              </Button>
            </div>
          </div>

          {error ? <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Queue</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="max-w-[240px] truncate font-mono text-xs">{job.id}</TableCell>
                  <TableCell>{job.name}</TableCell>
                  <TableCell>{job.queue}</TableCell>
                  <TableCell>{job.attempts}</TableCell>
                  <TableCell>
                    <Badge variant={job.state === 'failed' ? 'destructive' : 'outline'}>{job.state}</Badge>
                  </TableCell>
                  <TableCell>{new Date(job.updatedAt ?? job.createdAt).toLocaleTimeString()}</TableCell>
                  <TableCell>
                    {status === 'dlq' ? (
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            await retryDlqJob(job.queue, job.id);
                            await loadJobs();
                            await loadOverview();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Retry failed');
                          }
                        }}
                      >
                        Retry
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
