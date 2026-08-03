import { signIn } from "@/auth";
import { OWNER_SCOPES } from "@/auth.config";

/**
 * The one place the Drive scope is ever requested.
 *
 * Signing in through this button replaces the current session with the library
 * account's, which is the point: it is that account's refresh token the portal
 * needs. access_type=offline plus prompt=consent is what makes Google return a
 * refresh token rather than an access token that dies in an hour.
 */
export default function ConnectDriveButton({
  ownerEmail,
  connected,
}: {
  ownerEmail: string;
  connected: boolean;
}) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn(
          "google",
          { redirectTo: "/storage" },
          {
            scope: OWNER_SCOPES,
            access_type: "offline",
            prompt: "consent",
            login_hint: ownerEmail,
          },
        );
      }}
    >
      <button type="submit" className={connected ? "btn btn-ghost" : "btn btn-primary"}>
        {connected ? "Reconnect the library Drive" : "Connect the library Drive"}
      </button>
    </form>
  );
}