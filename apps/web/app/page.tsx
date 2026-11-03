import { Suspense } from 'react';
import { Dashboard } from '../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <Dashboard />
    </Suspense>
  );
}
