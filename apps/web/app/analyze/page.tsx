import { Suspense } from 'react';
import { Analyze } from '../../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <Analyze />
    </Suspense>
  );
}
