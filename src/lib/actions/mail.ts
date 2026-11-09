"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { configuredMailProviders, type MailProvider } from "@/lib/integrations/mail";
import { clearMailAccount, getMailAccount, type MailAccountSummary } from "@/lib/mail-accounts";

export interface MyMailAccount {
  account: MailAccountSummary | null;
  /** Providers the server has credentials for — the Connect buttons to show. */
  providers: MailProvider[];
  /** For the compose prefill ("Best regards, …"). */
  userName: string | null;
}

/** What the compose dialog needs to know before it can offer Send. */
export async function getMyMailAccount(): Promise<MyMailAccount> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Unauthorized");
  return {
    account: await getMailAccount(userId),
    providers: configuredMailProviders(),
    userName: session?.user?.name ?? null,
  };
}

/** Disconnects the current user's own mailbox. Self-service. */
export async function disconnectMailAccount() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  await clearMailAccount(session.user.id);
  revalidatePath("/settings/general");
}
