import type { Session } from "next-auth";
import { getServerSession, NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./db";

/** Resolve session to a userId that exists in the current DB (same DB for local and deployment). */
export async function getOrCreateUserId(session: Session): Promise<string | null> {
  if (!session?.user?.id && !session?.user?.email) return null;
  try {
    const existing = await prisma.user.findUnique({
      where: { id: session.user!.id },
    });
    if (existing) return existing.id;
    const email = session.user!.email ?? undefined;
    if (!email) return null;
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) return byEmail.id;
    const created = await prisma.user.create({
      data: {
        email,
        name: session.user!.name ?? email.split("@")[0],
      },
    });
    return created.id;
  } catch (e) {
    console.error("[auth] getOrCreateUserId error:", e);
    return null;
  }
}

/** Get current session and resolved userId; returns null if not authenticated or resolve fails. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return getOrCreateUserId(session);
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
      },
      async authorize(credentials) {
        if (!credentials?.email) return null;
        try {
          let user = await prisma.user.findUnique({ where: { email: credentials.email } });
          if (!user) {
            user = await prisma.user.create({
              data: {
                email: credentials.email,
                name: credentials.email.split("@")[0],
              },
            });
          }
          return { id: user.id, email: user.email, name: user.name };
        } catch (e) {
          console.error("[auth] authorize error:", e);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = (user as { email?: string }).email;
        token.name = (user as { name?: string | null }).name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = (token.email as string) ?? (session.user.email ?? null);
        session.user.name = (token.name as string | null) ?? session.user.name ?? null;
      }
      return session;
    },
  },
};
