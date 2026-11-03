import { Suspense } from 'react';
import { FormDetail } from '../../../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <FormDetail />
    </Suspense>
  );
}
