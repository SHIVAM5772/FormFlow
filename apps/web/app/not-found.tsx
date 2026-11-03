import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="panel empty">
      <h1>Page not found</h1>
      <p>Choose a page from the workspace navigation.</p>
      <Link href="/">Go to Dashboard</Link>
    </div>
  );
}
