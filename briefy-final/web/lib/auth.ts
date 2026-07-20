import 'server-only';
import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { resolveOwner } from './resolve-owner';

export type { OwnerResolution } from './resolve-owner';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async signIn({ user }) {
      const resolution = resolveOwner(user.email);
      if (!resolution.ok) {
        // NextAuth maps a thrown/returned-false signIn into a `?error=` query
        // param on the `error` page above; we distinguish the two reasons there.
        return resolution.reason === 'not_mapped' ? '/login?error=NotMapped' : false;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const resolution = resolveOwner(user.email);
        if (resolution.ok) token.dealOwner = resolution.dealOwner;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as typeof session.user & { dealOwner?: string }).dealOwner =
          token.dealOwner as string | undefined;
      }
      return session;
    },
  },
};
