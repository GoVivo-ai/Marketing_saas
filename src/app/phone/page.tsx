import { auth, signOut } from "@/lib/auth";
import { getContactQueue, getWorkspaceContext, type ContactQueueData } from "@/lib/data";
import { currentUser, isOperations } from "@/lib/permissions";
import { PhoneApp } from "@/components/app/mobile/phone-app";

const EMPTY_QUEUE: ContactQueueData = {
  items: [],
  total: 0,
  newCount: 0,
  followUpCount: 0,
  priorityCount: 0,
  coolingDown: 0,
  waiting: [],
};

export default async function PhonePage() {
  const [session, user, { active }] = await Promise.all([
    auth(),
    currentUser(),
    getWorkspaceContext(),
  ]);
  // Dispatch-only users have a phone but no leads to work.
  const hasQueue = !!active && !isOperations(user?.role);
  const queue = hasQueue ? await getContactQueue(active.id) : EMPTY_QUEUE;

  return (
    <PhoneApp
      queue={queue}
      hasQueue={hasQueue}
      workspaceName={active?.name ?? null}
      userName={session?.user?.name ?? null}
      signOutAction={async () => {
        "use server";
        await signOut({ redirectTo: "/login?next=/phone" });
      }}
    />
  );
}
