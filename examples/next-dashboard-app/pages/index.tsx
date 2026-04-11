import { supervisorMode } from '../src/runtime';

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 32, lineHeight: 1.6 }}>
      <h1>Next Vasto Example</h1>
      <p>Supervisor mode: <strong>{supervisorMode}</strong></p>
      <p>POST to <code>/api/jobs/email</code> to enqueue work.</p>
      <p>Open <code>/api/dashboard-api</code> for the dashboard API/static host after publishing dashboard assets.</p>
      {supervisorMode === 'api' ? (
        <p>API mode does not process jobs. Run <code>npm run worker</code> or set <code>SUPERVISOR_MODE=hybrid</code>.</p>
      ) : null}
      <pre>{`vasto dashboard:publish --out=./public/vasto-dashboard --base=/api/dashboard-api --api-base=/api/dashboard-api`}</pre>
    </main>
  );
}
