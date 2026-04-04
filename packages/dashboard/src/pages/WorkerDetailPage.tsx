import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Clock, Zap, Box, BarChart3 } from 'lucide-react';
import { useDashboardData } from '../contexts/DashboardDataContext';

export function WorkerDetailPage() {
  const { workerName } = useParams<{ workerName: string }>();
  const { overview } = useDashboardData();

  if (!workerName || !overview) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Loading worker…
      </div>
    );
  }

  const worker = overview.workers.configured.find(
    (w) => w.name === decodeURIComponent(workerName)
  );

  if (!worker) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-slate-500 text-sm">Worker not found: {workerName}</p>
        <Link to="/workers" className="text-indigo-600 hover:underline text-sm">
          Back to workers
        </Link>
      </div>
    );
  }

  const desiredScaling = overview.workers.desiredScaling[worker.name] ?? worker.concurrency;

  return (
    <div className="flex flex-col gap-6">
      {/* Header with back link */}
      <div className="flex items-center gap-3">
        <Link
          to="/workers"
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          title="Back to workers"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{worker.name}</h1>
          <p className="text-slate-400 text-sm mt-1">Worker configuration and scaling</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Isolation */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Box className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Isolation</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{worker.isolation}</div>
          <p className="text-xs text-slate-400 mt-2">Execution mode</p>
        </div>

        {/* Default Concurrency */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Default</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{worker.concurrency}</div>
          <p className="text-xs text-slate-400 mt-2">Default concurrency</p>
        </div>

        {/* Current Scaling */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Live</span>
          </div>
          <div className="text-2xl font-bold text-indigo-600">{desiredScaling}</div>
          <p className="text-xs text-slate-400 mt-2">Current concurrency</p>
        </div>

        {/* Queue Count */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-500 uppercase">Queues</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{worker.queues.length}</div>
          <p className="text-xs text-slate-400 mt-2">Assigned queues</p>
        </div>
      </div>

      {/* Configuration section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* General Config */}
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-3">General</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Name:</span>
                <span className="font-mono text-slate-900 font-semibold">{worker.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Isolation Mode:</span>
                <span className="font-mono text-slate-900 font-semibold">{worker.isolation}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Default Concurrency:</span>
                <span className="font-mono text-slate-900 font-semibold">{worker.concurrency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Concurrency:</span>
                <span className="font-mono text-indigo-600 font-semibold">{desiredScaling}</span>
              </div>
            </div>
          </div>

          {/* Assigned Queues */}
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-3">Assigned Queues</h4>
            <div className="flex flex-wrap gap-2">
              {worker.queues.length > 0 ? (
                worker.queues.map((q) => (
                  <Link
                    key={q}
                    to={`/queues/${encodeURIComponent(q)}`}
                    className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
                  >
                    {q}
                  </Link>
                ))
              ) : (
                <span className="text-sm text-slate-400">No queues assigned</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scaling section */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Scaling</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-3">Current State</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Desired:</span>
                <span className="font-mono text-indigo-600 font-semibold text-lg">{desiredScaling}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Default:</span>
                <span className="font-mono text-slate-700 font-semibold">{worker.concurrency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status:</span>
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-green-50 text-green-700">
                  Active
                </span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-3">Info</h4>
            <p className="text-sm text-slate-500 leading-relaxed">
              Adjust the concurrency level from the Workers page. The current value is the number
              of parallel job handlers for this worker across all assigned queues.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation footer */}
      <div className="flex justify-between pt-6">
        <Link
          to="/workers"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
        >
          ← Back to Workers
        </Link>
      </div>
    </div>
  );
}
