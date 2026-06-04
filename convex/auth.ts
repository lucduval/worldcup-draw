import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Email + password accounts. The sign-up form also sends a `name` field, which
// we persist on the user document so it can default each game's player name.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        return {
          email: params.email as string,
          name: ((params.name as string) || "").trim() || "Player",
        };
      },
    }),
  ],
});
