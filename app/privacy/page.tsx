import { headerName } from "../lib/memberProfileStore";
import { currentUser, supabaseForRequest } from "../lib/supabase";
import SiteHeader from "../SiteHeader";

/**
 * Privacy and Security First: Dane's article from
 * https://wavecenter.com/privacy-and-security-first/, carried word for word
 * (it is canon, so its own phrasing stays). Anyone may read it, signed in or
 * not. Your profile links here from its short privacy summary.
 */
export default async function Privacy() {
  const supabase = await supabaseForRequest();
  const { user } = supabase ? await currentUser(supabase) : { user: null };
  const name = supabase && user ? await headerName(supabase, user) : null;

  return (
    <>
      <SiteHeader name={name} />
      <main>
        <h1>Privacy and Security First</h1>
        <h2>Data Sovereignty and Privacy</h2>
        <p>{"Data Sovereignty and Privacy must be the hallmark of any Web3 platform, and WaveCenter will help establish this precedent by intentionally framing the area of privacy and security in favor of the individual."}</p>
        <p>{"This means that every individual user on the WaveCenter platform maintains complete control over every aspect of their personal privacy and security from one simple and intuitive interface."}</p>
        <p>{"In direct contrast to the current set of social media and related sites that encourage people to share there personal information liberally (in order to provide advertisers plenty of information to target), WaveCenter users’ profiles default to completely anonymous."}</p>
        <p>{"Users are known on the platform by their avatar, and only reveal their personal information to people as their relationships and circumstances warrant. Some people may choose to have a more public profile while others may choose to keep their personal data private. Either way, the choice is up to the users."}</p>
        <p>{"The WaveCenter approach to privacy and security is called the Wave Bubble. Each user is effectively in their own WaveBubble, which is a domain where they have total control over what comes in and what goes out."}</p>
        <p>
          <b>{"‘Security’"}</b> {"refers to how much content appears to users within their WaveBubble. The measure of Security is “Visibility”."}
        </p>
        <p>{"High Visibility means you can access lots of content from within your Wave Bubble. Visibility is controlled through “Filters”. Creating more Filters reduces your Visibility and improving your Security."}</p>
        <p>
          <b>{"‘Privacy’"}</b> {"refers to how much of your data can be accessed by the outside world. The measure of Privacy is your “Transparency”."}
        </p>
        <p>{"High Transparency means you are making a lot of your documents and information available to many people. Transparency is controlled through “Masks”. Creating more Masks reduces your Transparency, thereby enhancing your Privacy."}</p>
        <p>{"This schema provides the basis for a simple, intuitive interface that allows people to easily control exactly what they see of the outside world, and what people or groups can see about them or their family or friends."}</p>
        <p>{"This extends to all forms of advertisers or merchants, which have no access to individual information at all. Entities with services to offer can allow users to view their promotional material anonymously, and the users can have the option to sell their personal information to the vendor if they choose to. Or to be more accurate, they will grant the vendor the right to send promotional messages into their feed for a small fee."}</p>
        <p>{"This methodology eliminates the role of middleman that the current platforms currently play. Facebook focuses users attention and captures useful information about them, which they then repackage and sell to advertisers in the form of audience targeting. Ditto all the others."}</p>
        <p>{"As a user/owned organization, WaveCenter has no need to generate revenue by selling user data to advertisers. This is an entirely different business model."}</p>
        <p>{"In this model, if someone wants to get others’ attention, they simply pay for it directly. And instead of getting fleeced, end-users are able to turn their focused attention into an income generator — while maintaining complete control over their privacy and security."}</p>
      </main>
    </>
  );
}
