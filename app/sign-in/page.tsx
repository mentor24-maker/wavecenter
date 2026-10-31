import Link from "next/link";
import { redirect } from "next/navigation";
import SiteHeader from "../SiteHeader";
import { currentUser, supabaseForRequest } from "../lib/supabase";
import SignInForm from "./SignInForm";

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error } = await searchParams;

  const supabase = await supabaseForRequest();
  const { user, checkFailed } = supabase ? await currentUser(supabase) : { user: null, checkFailed: false };
  if (user) redirect("/");

  return (
    <>
      <SiteHeader showSignIn={false} />
      <main>
        <h1>Log in</h1>
        <SignInForm from="/sign-in" error={error} checkFailed={checkFailed} />
        <p className="note">
          <Link href="/">Back to WaveCenter</Link>
        </p>
      </main>
    </>
  );
}
