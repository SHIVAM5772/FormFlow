'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="notice error">
      <p>This page could not load. Please try again.</p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
