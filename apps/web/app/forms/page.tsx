import { Suspense } from 'react';
import { Forms } from '../../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <Forms />
    </Suspense>
  );
}
