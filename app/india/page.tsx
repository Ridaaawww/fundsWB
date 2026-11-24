import type { Metadata } from "next";
import Link from "next/link";
import { byState, isIndia, isOpen, loadPrograms, loadSignals } from "../data";
import { ProgramBrowser } from "../program-browser";
import { Checked, TopNav, XFeed } from "../site-chrome";

export const metadata: Metadata = {
  title: "India · Funds Radar",
  description: "Grants, government schemes, incubators, investors and venture debt for Indian founders, from idea to mid-stage.",
};

export default function India() {
  const programs = loadPrograms().filter(isIndia);
  const located = byState(programs);
  const latest = programs.map((p) => p.last_checked).sort().at(-1);
  const schemes = programs.filter((p) => p.type === "grant" || p.type === "other").length;
  const states = located.order.length - 1;

  return (
    <main>
      <TopNav active="india" />
      <header className="hero">
        <Checked iso={latest} />
        <p>Funding for Indian founders, from the first idea to the growth stage.</p>
        <p>
          {programs.length} programs in one place: {schemes} central and state government schemes, plus incubators,
          accelerators, angel and pre-seed investors, and venture debt, across {states} states.{" "}
          {programs.filter(isOpen).length} are open right now.
        </p>
        <Link href="/" className="cta">
          See programs worldwide
        </Link>
      </header>

      <XFeed signals={loadSignals().filter((s) => s.country === "India" || /india/i.test(`${s.program} ${s.summary}`))} />

      <ProgramBrowser programs={located.programs} places={located.order} allPlaces="All of India" groupBy="category" />
    </main>
  );
}
