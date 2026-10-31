import InfoPage from "../InfoPage";

const WHITEPAPER =
  "https://github.com/mentor24-maker/wavecenter/blob/main/docs/canon/deo-whitepaper.md";

/**
 * What is a DEO, opened from Home: a short summary of Dane's whitepaper,
 * docs/canon/deo-whitepaper.md. It is canon, so every sentence here comes
 * from the whitepaper, and its own phrasing is quoted where a summary would
 * lose precision. Change the whitepaper first; this page follows it.
 */
export default function Deo() {
  return (
    <InfoPage title="What is a DEO">
      <h2>An organization built on engagement, not capital</h2>
      <p>{"A DEO is a Decentralized Engagement Organization: one in which “human engagement — rather than capital investment — is the founding resource, the operating fuel, and the ultimate purpose of the enterprise.”"}</p>
      <p>{"Every organization today begins with the question “who will pay for it?” The DEO starts from a different claim: “Human creative collaboration is the primary source of value. Coordination is the means of generating and capturing that value.” Capital is one way to coordinate people, but only one, and an organization coordinated by capital answers to capital, permanently."}</p>
      <p>{"The E in DEO stands for Engagement, not equity. Engagement between people is both the source of the organization’s value and the purpose of its existence."}</p>

      <h2>The game layer</h2>
      <p>{"What makes an organization a DEO is a single commitment: “every act of engagement, from passive content consumption to software development to governance itself, is captured, valued, and accrued to the member who performed it.”"}</p>
      <p>{"This game layer is native, woven into the technical foundation rather than bolted on, so nothing a member contributes goes unaccounted for. Members set the value of each kind of engagement themselves, by continuous vote. The same machinery that credits constructive contribution debits toxic or manipulative behaviour."}</p>

      <h2>How decisions are made</h2>
      <p>{"Governance is conducted through the game layer. Voting is simply another form of engagement, so taking part in governance is rewarded rather than extracted as unpaid duty."}</p>
      <p>{"Voting power comes from tokens earned through engagement together with a reputation score that cannot be transferred, built purely from a history of constructive contribution. “Influence cannot be bought.” An outsider who buys a mountain of tokens, without a reputation earned inside the community, has minimal voting power."}</p>

      <h2>No fiat pay inside</h2>
      <p>{"Inside a DEO, “no one is paid in USD or any other fiat currency.” There are no wages and no salaries; engagement earns value in the organization’s own points and tokens. Cash can come in only as revenue from selling what the DEO itself produces: “Never as capital investment, never as debt.”"}</p>

      <h2>Your data, and who can join</h2>
      <p>{"Members are anonymous by default, known to the people who invited them and to no one else. They own their personal data and interaction history outright, and share it only at their own discretion."}</p>
      <p>{"Membership is by invitation, and every member is a verified human, so that no one can pretend to be thousands of people. As the whitepaper puts it, “the system knows you are a unique human without needing to know who you are.”"}</p>

      <h2>AI that helps, never replaces</h2>
      <p>{"AI is available to every member. Machines are good at fast synthesis, spotting patterns and administrative work; people bring vision, creativity, ethical judgment and lived experience. “The DEO deploys AI to augment its humans, never to replace them,” and humans have the final say over every automated decision."}</p>

      <h2>The four seasons</h2>
      <p>
        <b>Winter</b>
        {" is where every DEO begins: “no capital, no resources, not even people yet — just plans and code.” The founding doctrine is written, the first software takes shape, and the game layer is designed to value contributions no one has made yet."}
      </p>
      <p>
        <b>Spring</b>
        {" brings the people. Members earn their livings in the legacy economy and contribute to their DEO part-time."}
      </p>
      <p>
        <b>Summer</b>
        {" is production. The organization earns revenue through the one permitted channel and reinvests it in its infrastructure and mission."}
      </p>
      <p>
        <b>Fall</b>
        {" is the harvest, when the organization returns rewards in a way that honours the work. What the harvest consists of is deliberately left open: “Members decide.”"}
      </p>

      <p className="note">
        {"Source: "}
        <a href={WHITEPAPER}>
          White Paper: The Decentralized Engagement Organization (DEO)
        </a>
        {", by Dane Christensen with Claude Fable, July 2026."}
      </p>
    </InfoPage>
  );
}
