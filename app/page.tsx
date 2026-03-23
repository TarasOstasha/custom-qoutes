import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container">
      <div className="card section">
        <h1 className="title">Quote App Demo</h1>
        <p className="muted">Frontend-only presentation demo for internal quoting.</p>
        <div className="actions" style={{ marginTop: 12 }}>
          <Link className="btn primary" href="/quote-builder">
            Open Quote Builder
          </Link>
          <Link className="btn" href="/quote-preview">
            Open Quote Preview
          </Link>
        </div>
      </div>
    </main>
  );
}
