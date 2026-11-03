import { Suspense } from 'react';
import { Templates } from '../../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <Templates />
    </Suspense>
  );
}
