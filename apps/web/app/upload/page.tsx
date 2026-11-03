import { Suspense } from 'react';
import { Upload } from '../../src/App';
export default function Page() {
  return (
    <Suspense fallback={<p className="boot">Loading workspace…</p>}>
      <Upload />
    </Suspense>
  );
}
