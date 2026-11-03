import { Suspense } from 'react';
import { Settings } from '../../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <Settings />
    </Suspense>
  );
}
