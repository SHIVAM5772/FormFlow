import { Suspense } from 'react';
import { Jobs } from '../../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <Jobs reports />
    </Suspense>
  );
}
