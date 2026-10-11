/**
 * The placeholder page: the only page WaveCenter has until the to-do list
 * ships. It says what this is, so a visitor who lands here early does not
 * see a blank screen (engineering rule 7: an empty screen says why).
 */
export default function Home() {
  return (
    <main>
      <h1>WaveCenter</h1>
      <p className="lede">The hub of the DEO movement. Coming soon.</p>
      <p>
        WaveCenter&rsquo;s mission is to build a modern alternative to the World Wide
        Web, and a platform on which other DEOs can extend that mission or develop
        new concepts. A DEO is a Decentralized Engagement Organization: one in which
        human engagement, not capital investment, is the founding resource, the
        operating fuel and the purpose.
      </p>
      <p className="note">
        Nothing to sign in to yet. This page will become a simple to-do list, then a
        project management tool, then the platform the DEO builds itself with.
      </p>
    </main>
  );
}
