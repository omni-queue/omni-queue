import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BarChart2,
  Boxes,
  Briefcase,
  Database,
  CheckCircle2,
  LayoutDashboard,
  Layers,
  Menu,
  LogOut,
  RefreshCw,
  BellOff,
  Users,
  X,
} from 'lucide-react';
import { useDashboardAuth } from '../contexts/DashboardAuthContext';
import { useDashboardData } from '../contexts/DashboardDataContext';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/monitoring', label: 'Monitoring', icon: Activity },
  { path: '/archive', label: 'Archive', icon: Database },
  { path: '/batches', label: 'Batches', icon: Boxes },
  { path: '/queues', label: 'Queues', icon: Layers },
  { path: '/jobs', label: 'Jobs', icon: Briefcase },
  { path: '/completed', label: 'Completed Jobs', icon: CheckCircle2 },
  { path: '/silenced', label: 'Silenced Jobs', icon: BellOff },
  { path: '/workers', label: 'Workers', icon: Users },
  { path: '/failed', label: 'Failed Jobs', icon: AlertTriangle },
  { path: '/metrics', label: 'Metrics', icon: BarChart2 },
] as const;

function ConnectionDot({ connected, connecting }: { connected: boolean; connecting: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
      <span
        className={`relative inline-flex rounded-full h-2 w-2 ${connected ? 'bg-emerald-500' : connecting ? 'bg-amber-400' : 'bg-slate-500'}`}
      />
    </span>
  );
}

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { overview, refreshOverview, transportMode, wsStatus } = useDashboardData();
  const { requiresAuth, logout } = useDashboardAuth();

  const connectionLabel =
    transportMode === 'polling'
      ? 'Polling mode'
      : wsStatus === 'connected'
        ? 'Live'
        : wsStatus === 'connecting'
          ? 'Connecting…'
          : 'Polling (fallback)';

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed z-30 inset-y-0 left-0 flex w-64 flex-shrink-0 flex-col bg-slate-900 text-white transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:translate-x-0 lg:flex`}
      >
        <div className="flex items-center justify-between h-16 px-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">OQ</div>
            <span className="font-semibold tracking-tight text-sm">Omni Queue</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
                {item.path === '/failed' && (overview?.totals.dlq ?? 0) > 0 && (
                  <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1 text-xs font-bold rounded-full bg-red-600 text-white">
                    {(overview?.totals.dlq ?? 0) > 99 ? '99+' : overview?.totals.dlq}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-slate-800 flex items-center gap-2 text-xs text-slate-500">
          <ConnectionDot connected={wsStatus === 'connected'} connecting={wsStatus === 'connecting'} />
          <span>{connectionLabel}</span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between h-16 px-6 bg-white border-b border-slate-100 flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-slate-500 hover:text-slate-900">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void refreshOverview();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            {requiresAuth ? (
              <button
                onClick={() => {
                  void logout();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            ) : null}
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
