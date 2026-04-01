export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 32, lineHeight: 1.6 }}>
      <h1>Next Omni Queue Example</h1>
      <p>POST to <code>/api/jobs/email</code> to enqueue work.</p>
      <p>Open <code>/api/dashboard-api</code> for the dashboard API/static host after publishing dashboard assets.</p>
      <pre>{`queue dashboard:publish --out=./public/omni-queue-dashboard --base=/api/dashboard-api --api-base=/api/dashboard-api`}</pre>
    </main>
  );
}
