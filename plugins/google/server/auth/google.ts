import passport from "@outlinewiki/koa-passport";
import type { Context } from "koa";
import Router from "koa-router";
import capitalize from "lodash/capitalize";
import type { Profile } from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import { languages } from "@shared/i18n";
import { slugifyDomain } from "@shared/utils/domains";
import accountProvisioner from "@server/commands/accountProvisioner";
import { TeamDomainRequiredError } from "@server/errors";
import Logger from "@server/logging/Logger";
import passportMiddleware from "@server/middlewares/passport";
import { User } from "@server/models";
import type { AuthenticationResult } from "@server/types";
import {
  StateStore,
  getTeamFromContext,
  getClientFromOAuthState,
  getUserFromOAuthState,
} from "@server/utils/passport";
import config from "../../plugin.json";
import env from "../env";
import { createContext } from "@server/context";

const router = new Router();

const scopes = [
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
];

type GoogleProfile = Profile & {
  email: string;
  picture: string;
  _json: {
    hd?: string;
    locale?: string;
  };
};

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${env.URL}/auth/${config.id}.callback`,
        passReqToCallback: true,
        // @ts-expect-error StateStore
        store: new StateStore(),
        scope: scopes,
      },
      async function (
        context: Context,
        accessToken: string,
        refreshToken: string,
        params: { expires_in: number },
        profile: GoogleProfile,
        done: (
          err: Error | null,
          user: User | null,
          result?: AuthenticationResult
        ) => void
      ) {
        try {
          // "domain" is the Google Workspaces domain
          const domain = profile._json.hd;
          const team = await getTeamFromContext(context);
          const client = getClientFromOAuthState(context);
          const user =
            context.state?.auth?.user ?? (await getUserFromOAuthState(context));

          // Personal gmail accounts (no domain) signing in on the apex URL
          // must still specify a team subdomain if they already belong to one.
          // Creating a brand-new team with a personal gmail account is allowed:
          // the team is created with empty allowedDomains so other gmail users
          // cannot auto-join — admins must invite them.
          if (!domain && !team) {
            const userExists = await User.count({
              where: { email: profile.email.toLowerCase() },
              include: [
                {
                  association: "team",
                  required: true,
                },
              ],
            });

            if (userExists) {
              throw TeamDomainRequiredError();
            }
          }

          // remove the TLD and form a subdomain from the remaining
          // subdomains of the form "foo.bar.com" are allowed as primary Google Workspaces domains
          // see https://support.google.com/nonprofits/thread/19685140/using-a-subdomain-as-a-primary-domain
          const subdomain = domain ? slugifyDomain(domain) : "";
          const teamName = capitalize(subdomain);

          // Request a larger size profile picture than the default by tweaking
          // the query parameter.
          const avatarUrl = profile.picture.replace("=s96-c", "=s128-c");
          const locale = profile._json.locale;
          const language = locale
            ? languages.find((l) => l.startsWith(locale))
            : undefined;

          // if a team can be inferred, we assume the user is only interested in signing into
          // that team in particular; otherwise, we will do a best effort at finding their account
          // or provisioning a new one (within AccountProvisioner)
          const ctx = createContext({
            ip: context.ip,
            user,
            authType: context.state?.auth?.type,
          });
          const result = await accountProvisioner(ctx, {
            team: {
              teamId: team?.id,
              name: teamName,
              domain,
              subdomain,
            },
            user: {
              email: profile.email,
              name: profile.displayName,
              language,
              avatarUrl,
            },
            authenticationProvider: {
              name: config.id,
              providerId: domain ?? "",
            },
            authentication: {
              providerId: profile.id,
              accessToken,
              refreshToken,
              expiresIn: params.expires_in,
              scopes,
            },
          });

          return done(null, result.user, { ...result, client });
        } catch (err) {
          Logger.warn("Google auth failed", {
            email: profile?.email,
            domain: profile?._json?.hd,
            providerId: profile?.id,
            ip: context.ip,
            error: err?.message,
          });
          return done(err, null);
        }
      }
    )
  );

  router.get(
    config.id,
    passport.authenticate(config.id, {
      accessType: "offline",
      prompt: "select_account consent",
    })
  );
  router.get(`${config.id}.callback`, passportMiddleware(config.id));
}

export default router;
