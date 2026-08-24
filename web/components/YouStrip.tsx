"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useIdentity } from "./useIdentity";
import { CheckMark, ChevronRight, GithubMark } from "./icons";
import { browserSupabase } from "@/lib/supabase/client";
import { KIND } from "@/lib/identity";

/**
 * The one row at the top of the dashboard that is about *you*.
 *
 * Three states, one action each. A dashboard that shows the same call to
 * action to a stranger and to somebody already listed is a dashboard nobody
 * reads twice, so the strip changes shape instead of accumulating buttons:
 *
 *   not connected → Submit yourself   (the form asks for GitHub itself)
 *   verified, unlisted → Submit yourself, with the handle shown
 *   listed → the calm state: view or edit
 */
export default function YouStrip() {
  const { identity } = useIdentity();
  const supabase = useMemo(() => browserSupabase(), []);
  const [listed, setListed] = useState<boolean | null>(null);

  const handle = identity.status === "verified" ? identity.handle : null;

  useEffect(() => {
    if (!supabase || !handle) return;
    let alive = true;

    void (async () => {
      // `public_cards` is the same view the directory reads, so "listed" here
      // means exactly what being in the list means. A draft counts as not
      // listed, which is the truth from a visitor's side.
      const { data } = await supabase
        .from("public_cards")
        .select("has_card")
        .eq("kind", KIND.GithubUser)
        .eq("handle", handle)
        .maybeSingle();
      if (alive) setListed(data?.has_card === true);
    })();

    return () => {
      alive = false;
    };
  }, [supabase, handle]);

  if (identity.status === "off") return null;

  if (identity.status === "loading") {
    return <div className="skeleton h-16 w-full" />;
  }

  if (identity.status === "anon") {
    return (
      <Row
        title="Get paid for what you already do"
        body="Developers and amplifiers: one short form puts you in this list."
        cta="Submit yourself"
        href="/app/submit"
      />
    );
  }

  if (listed === true) {
    return (
      <Row
        icon={
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-accent-fg">
            <CheckMark size={14} />
          </span>
        }
        title={`You are listed as @${handle}`}
        body="People can find you here and pay your handle."
        cta="Edit your card"
        quiet
        href="/app/submit"
        extra={
          <Link className="btn btn-quiet btn-sm" href={`/p/gh/${handle}`}>
            View my page
          </Link>
        }
      />
    );
  }

  return (
    <Row
      icon={
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-raised text-dim">
          <GithubMark size={16} />
        </span>
      }
      title={`@${handle} is verified`}
      body="You are not in the list yet — two fields and a role away."
      cta="Submit yourself"
      href="/app/submit"
    />
  );
}

function Row({
  icon,
  title,
  body,
  cta,
  href,
  quiet = false,
  extra,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  href: string;
  quiet?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-mute">{body}</p>
      </div>
      {extra}
      <Link className={`btn ${quiet ? "btn-ghost" : "btn-primary"}`} href={href}>
        {cta}
        <ChevronRight />
      </Link>
    </div>
  );
}
