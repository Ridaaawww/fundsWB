// Header nav, the "checked" line and the X feed, shared by every page.
import Link from "next/link";
import type { Signal } from "./data";

export function TopNav({ active }: { active: "world" | "india" }) {
  return (
    <nav className="topnav" aria-label="Sections">
      <Link href="/" className="brand">
        Funds Radar
      </Link>
      <div>
        <Link href="/" aria-current={active === "world" ? "page" : undefined}>
          Worldwide
        </Link>
        <Link href="/india/" aria-current={active === "india" ? "page" : undefined}>
          India
        </Link>
      </div>
    </nav>
  );
}

export function Checked({ iso }: { iso?: string }) {
  if (!iso) return null;
  const date = new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <span className="eyebrow">
      Last checked <time dateTime={iso}>{date}</time>
    </span>
  );
}

const KIND_LABEL: Record<string, string> = {
  applications_open: "Applications open",
  deadline: "Deadline",
  new_program: "New program",
  terms_changed: "Terms changed",
  closed: "Closed",
  other: "Update",
};

/** The newest funding news Grok found on X. Leads only: the list below is built from official pages. */
export function XFeed({ signals }: { signals: Signal[] }) {
  if (!signals.length) return null;
  return (
    <section className="section xfeed" aria-label="Latest from X">
      <div className="section-head">
        <h2>Latest from X</h2>
        <span>Spotted by Grok; each one sends us back to the official page</span>
      </div>
      <ul className="list">
        {signals.slice(0, 6).map((s) => (
          <li className="item" key={s.post_url}>
            <span className="kind">{KIND_LABEL[s.kind] ?? "Update"}</span>
            <h3>{s.program}</h3>
            <p>{s.summary}</p>
            <div className="meta">
              {s.posted_on} · <a href={s.post_url}>View post</a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
