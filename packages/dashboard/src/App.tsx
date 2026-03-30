import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardDataProvider, useDashboardData } from './contexts/DashboardDataContext';
import { DashboardPage } from './pages/DashboardPage';
import { JobDetailPage } from './pages/JobDetailPage';
import { QueuesPage } from './pages/QueuesPage';
import { QueueDetailPage } from './pages/QueueDetailPage';
import { JobsPage } from './pages/JobsPage';
import { WorkersPage } from './pages/WorkersPage';
import { WorkerDetailPage } from './pages/WorkerDetailPage';
import { DlqPage } from './pages/DlqPage';
import { MetricsPage } from './pages/MetricsPage';
import { CompletedJobsPage } from './pages/CompletedJobsPage';
import { SilencedJobsPage } from './pages/SilencedJobsPage';
import { BatchesPage } from './pages/BatchesPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { ArchivePage } from './pages/ArchivePage';

function DashboardRoute() {
  const { overview } = useDashboardData();
  return <DashboardPage overview={overview} />;
}

function QueuesRoute() {
  const { queues, overview } = useDashboardData();
  return <QueuesPage queues={queues} reliability={overview?.reliability} />;
}

function JobsRoute() {
  const { queues } = useDashboardData();
  return <JobsPage queues={queues} />;
}

function QueueDetailRoute() {
  return <QueueDetailPage />;
}

function JobDetailRoute() {
  return <JobDetailPage />;
}

function WorkerDetailRoute() {
  return <WorkerDetailPage />;
}

function WorkersRoute() {
  const { overview, refreshOverview } = useDashboardData();
  return <WorkersPage overview={overview} onRefresh={() => { void refreshOverview(); }} />;
}

function DeadLetterRoute() {
  const { queues } = useDashboardData();
  return <DlqPage queues={queues} />;
}

function MetricsRoute() {
  const { samples, overview, wsStatus } = useDashboardData();
  return <MetricsPage samples={samples} overview={overview} wsStatus={wsStatus} />;
}

function CompletedJobsRoute() {
  const { queues } = useDashboardData();
  return <CompletedJobsPage queues={queues} />;
}

function SilencedJobsRoute() {
  const { queues } = useDashboardData();
  return <SilencedJobsPage queues={queues} />;
}

function BatchesRoute() {
  return <BatchesPage />;
}

function MonitoringRoute() {
  return <MonitoringPage />;
}

function ArchiveRoute() {
  const { queues } = useDashboardData();
  return <ArchivePage queues={queues} />;
}

export function App() {
  return (
    <DashboardDataProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardRoute />} />
          <Route path="monitoring" element={<MonitoringRoute />} />
          <Route path="archive" element={<ArchiveRoute />} />
          <Route path="batches" element={<BatchesRoute />} />
          <Route path="queues" element={<QueuesRoute />} />
          <Route path="queues/:queueName" element={<QueueDetailRoute />} />
          <Route path="jobs" element={<JobsRoute />} />
          <Route path="jobs/:jobId" element={<JobDetailRoute />} />
          <Route path="completed" element={<CompletedJobsRoute />} />
          <Route path="silenced" element={<SilencedJobsRoute />} />
          <Route path="workers" element={<WorkersRoute />} />
          <Route path="workers/:workerName" element={<WorkerDetailRoute />} />
          <Route path="failed" element={<DeadLetterRoute />} />
          <Route path="dead-letter" element={<DeadLetterRoute />} />
          <Route path="metrics" element={<MetricsRoute />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DashboardDataProvider>
  );
}

