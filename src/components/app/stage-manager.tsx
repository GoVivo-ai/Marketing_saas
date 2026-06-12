"use client";

import { Settings2, Plus, Trash2, ChevronUp, ChevronDown, Check } from "lucide-react";
import {
  createStage,
  updateStage,
  moveStage,
  deleteStage,
} from "@/lib/actions/stages";
import type { Stage } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** Funnel semantics — drives reporting (won = a sale/result). */
const KINDS = [
  { value: "open", label: "In progress" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export function StageManager({
  workspaceId,
  stages,
}: {
  workspaceId: string;
  stages: Stage[];
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Settings2 className="mr-1 h-3.5 w-3.5" />
            Edit stages
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Pipeline stages</DialogTitle>
          <DialogDescription>
            Top to bottom here is left to right on the board. Use the arrows to
            reorder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {stages.map((s, i) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-l-4 bg-card p-2.5"
              style={{ borderLeftColor: s.color ?? "#94a3b8" }}
            >
              {/* Order in the funnel — one number, no duplicates. */}
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                {i + 1}
              </span>

              <form action={updateStage} className="flex min-w-0 flex-1 items-center gap-2">
                <input type="hidden" name="stageId" value={s.id} />
                <input
                  type="color"
                  name="color"
                  defaultValue={s.color ?? "#011640"}
                  className="h-8 w-8 shrink-0 cursor-pointer rounded-md border bg-transparent"
                  title="Stage color"
                />
                <Input
                  name="name"
                  defaultValue={s.name}
                  className="h-8 min-w-28 flex-1"
                  required
                  aria-label="Stage name"
                />
                <select
                  name="kind"
                  defaultValue={s.kind}
                  className="h-8 shrink-0 rounded-md border bg-background px-1.5 text-xs"
                  title="How this stage counts in reporting"
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <Button size="icon-sm" type="submit" variant="secondary" title="Save changes">
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </form>

              <div className="ml-auto flex items-center gap-0.5">
                <form action={moveStage}>
                  <input type="hidden" name="stageId" value={s.id} />
                  <input type="hidden" name="direction" value="up" />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="submit"
                    disabled={i === 0}
                    title="Move up (earlier in the funnel)"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                </form>
                <form action={moveStage}>
                  <input type="hidden" name="stageId" value={s.id} />
                  <input type="hidden" name="direction" value="down" />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="submit"
                    disabled={i === stages.length - 1}
                    title="Move down (later in the funnel)"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </form>

                <Dialog>
                  <DialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={stages.length <= 1}
                        title="Delete stage"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    }
                  />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete “{s.name}”?</DialogTitle>
                      <DialogDescription>
                        Its leads move to the adjacent stage. This can&apos;t be
                        undone.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose render={<Button variant="outline">Cancel</Button>} />
                      <form action={deleteStage}>
                        <input type="hidden" name="stageId" value={s.id} />
                        <Button variant="destructive" type="submit">
                          Delete stage
                        </Button>
                      </form>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          ))}
        </div>

        <form action={createStage} className="flex items-center gap-2 border-t pt-3">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Input name="name" placeholder="New stage name…" className="h-8" required />
          <Button size="sm" type="submit">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add stage
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
