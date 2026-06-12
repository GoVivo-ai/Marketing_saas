"use client";

import { useState } from "react";
import { Settings2, Plus, Trash2, ChevronUp, ChevronDown, Check, Pipette } from "lucide-react";
import { createStage, saveStages } from "@/lib/actions/stages";
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

const FORM_ID = "stage-editor-form";

/**
 * Polished color well: a round swatch that opens the native picker and
 * previews the choice live (replaces the bare square color input).
 */
function ColorSwatch({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [color, setColor] = useState(defaultValue);
  return (
    <label
      className="group relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full shadow-sm ring-1 ring-inset ring-foreground/15 transition-transform hover:scale-110 focus-within:ring-2 focus-within:ring-ring"
      style={{ backgroundColor: color }}
      title="Stage color"
    >
      <Pipette className="h-3.5 w-3.5 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-90" />
      <input
        type="color"
        name={name}
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Stage color"
      />
    </label>
  );
}

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
            Top to bottom here is left to right on the board. Edit freely —
            one Save applies everything. Arrows reorder right away (your edits
            are kept).
          </DialogDescription>
        </DialogHeader>

        {/* One form for the whole editor: row inputs are keyed by stage id,
            and the arrow/delete buttons submit it too so edits never get
            lost when reordering or removing a stage. */}
        <form id={FORM_ID} action={saveStages} className="space-y-2">
          <input type="hidden" name="workspaceId" value={workspaceId} />

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

              <ColorSwatch name={`color:${s.id}`} defaultValue={s.color ?? "#011640"} />
              <Input
                name={`name:${s.id}`}
                defaultValue={s.name}
                className="h-8 min-w-28 flex-1"
                required
                aria-label="Stage name"
              />
              <select
                name={`kind:${s.id}`}
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

              <div className="ml-auto flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="submit"
                  name="move"
                  value={`up:${s.id}`}
                  disabled={i === 0}
                  title="Move up (earlier in the funnel)"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  type="submit"
                  name="move"
                  value={`down:${s.id}`}
                  disabled={i === stages.length - 1}
                  title="Move down (later in the funnel)"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>

                <Dialog>
                  <DialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="button"
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
                      {/* Submits the main editor form (form attribute) so any
                          pending edits are saved along with the removal. */}
                      <DialogClose
                        render={
                          <Button
                            variant="destructive"
                            type="submit"
                            form={FORM_ID}
                            name="delete"
                            value={s.id}
                          >
                            Delete stage
                          </Button>
                        }
                      />
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          ))}

          <div className="flex justify-end border-t pt-3">
            <Button type="submit">
              <Check className="mr-1.5 h-4 w-4" />
              Save changes
            </Button>
          </div>
        </form>

        <form action={createStage} className="flex items-center gap-2 border-t pt-3">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Input name="name" placeholder="New stage name…" className="h-8" required />
          <Button size="sm" type="submit" variant="secondary">
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add stage
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
