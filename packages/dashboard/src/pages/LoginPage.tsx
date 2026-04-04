import { useMemo, useState } from 'react';
import { LockKeyhole, Shield } from 'lucide-react';
import { useDashboardAuth } from '../contexts/DashboardAuthContext';

export function LoginPage() {
  const { authType, loginMode, login } = useDashboardAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modeLabel = useMemo(() => {
    if (authType === 'basic') {
      return 'username and password';
    }

    if (loginMode === 'token') {
      return 'bearer token';
    }

    return 'username and password';
  }, [authType, loginMode]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (loginMode === 'token') {
        await login({ token });
      } else {
        await login({ username, password });
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Vasto Dashboard</h1>
            <p className="text-sm text-slate-400">Sign in with {modeLabel} to continue.</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {loginMode === 'token' ? (
            <div>
              <label htmlFor="dashboard-token" className="block text-sm font-medium text-slate-300 mb-2">
                Bearer token
              </label>
              <textarea
                id="dashboard-token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="w-full min-h-28 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Paste your bearer token"
                required
              />
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="dashboard-username" className="block text-sm font-medium text-slate-300 mb-2">
                  Username
                </label>
                <input
                  id="dashboard-username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter your username"
                  required
                />
              </div>

              <div>
                <label htmlFor="dashboard-password" className="block text-sm font-medium text-slate-300 mb-2">
                  Password
                </label>
                <input
                  id="dashboard-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter your password"
                  required
                />
              </div>
            </>
          )}

          {error ? (
            <div className="rounded-xl border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
          >
            <LockKeyhole className="h-4 w-4" />
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
