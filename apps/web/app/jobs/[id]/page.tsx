import { Suspense } from 'react';
import { JobDetail } from '../../../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <JobDetail />
    </Suspense>
  );
}
