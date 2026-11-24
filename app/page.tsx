// Built at `next build` time from data/programs.json, so the deployed site is plain static files.
import Link from "next/link";
import { REGIONS } from "@/agent/schema";
import { isOpen, loadPrograms, loadSignals, takesNoEquity } from "./data";
import { ProgramBrowser } from "./program-browser";
import { Checked, TopNav, XFeed } from "./site-chrome";

export default function Home() {
  const programs = loadPrograms();
  const latest = programs.map((p) => p.last_checked).sort().at(-1);
  const regions = new Set(programs.map((p) => p.region)).size;

  return (
    <main>
      <TopNav active="world" />
      <header className="hero">
        <Checked iso={latest} />
        <p>Funds Radar keeps track of the money and support available to founders, from grants and fellowships to accelerators and investors.</p>
        <p>
          It follows {programs.length} programs across {regions} regions. {programs.filter(isOpen).length} are taking applications
          right now, and {programs.filter(takesNoEquity).length} take no equity. Every program is re-read from its own page, and
          changes are logged.
        </p>
        <Link href="/india/" className="cta">
          Funding for Indian founders
        </Link>
      </header>

      <XFeed signals={loadSignals()} />

      <ProgramBrowser
        programs={programs.map((p) => ({ ...p, where: p.region }))}
        places={REGIONS.filter((r) => programs.some((p) => p.region === r))}
        allPlaces="All locations"
        groupBy="place"
      />
    </main>
  );
}
