import Link from "next/link";

/**
 * A short version of Dane's "Privacy and Security First" article, shown on
 * Your profile. Every idea here comes from that article (the full text is on
 * /privacy); edit the wording here and nowhere else.
 */
export default function PrivacySummary() {
  return (
    <section className="panel" aria-labelledby="privacy-summary">
      <h2 id="privacy-summary">Your privacy on WaveCenter</h2>
      <p>
        Every member keeps complete control over their own privacy and security. Your profile
        starts completely anonymous: other members know you by your avatar, and you reveal more
        only as your relationships and circumstances warrant.
      </p>
      <p>
        WaveCenter calls this the Wave Bubble. Each member is in their own Wave Bubble, where
        they have total control over what comes in and what goes out.
      </p>
      <p>
        <b>Security</b> is how much content reaches you, measured as Visibility and controlled
        with Filters. <b>Privacy</b> is how much of your data the outside world can reach,
        measured as Transparency and controlled with Masks.
      </p>
      <p>
        WaveCenter is owned by its members, so it has no need to sell member data to
        advertisers. Advertisers and merchants have no access to your information unless you
        choose to grant it.
      </p>
      <p>
        <Link href="/privacy">Learn more about privacy and security on WaveCenter</Link>
      </p>
    </section>
  );
}
