"use client";

import { Settings2, Plus, Trash2, ArrowLeft, ArrowRight } from "lucide-react";
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
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pipeline stages</DialogTitle>
          <DialogDescription>
            Rename, recolor, reorder or remove the stages of your funnel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {stages.map((s, i) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
            >
              <form action={updateStage} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="stageId" value={s.id} />
                <input
                  type="color"
                  name="color"
                  defaultValue={s.color ?? "#011640"}
                  className="h-8 w-8 shrink-0 rounded border bg-transparent"
                  title="Stage color"
                />
                <Input name="name" defaultValue={s.name} className="h-8" required />
                <Button size="sm" type="submit" variant="secondary">
                  Save
                </Button>
              </form>
              <div className="flex items-center gap-1">
                <form action={moveStage}>
                  <input type="hidden" name="stageId" value={s.id} />
                  <input type="hidden" name="direction" value="left" />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="submit"
                    disabled={i === 0}
                    title="Move left"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                </form>
                <form action={moveStage}>
                  <input type="hidden" name="stageId" value={s.id} />
                  <input type="hidden" name="direction" value="right" />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="submit"
                    disabled={i === stages.length - 1}
                    title="Move right"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </form>
                <form
                  action={deleteStage}
                  onSubmit={(e) => {
                    if (
                      !confirm(
                        `Delete "${s.name}"? Its leads move to the previous stage.`,
                      )
                    )
                      e.preventDefault();
                  }}
                >
                  <input type="hidden" name="stageId" value={s.id} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    type="submit"
                    className="text-destructive hover:text-destructive/80"
                    disabled={stages.length <= 1}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </form>
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
