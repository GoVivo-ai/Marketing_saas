"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { Phone, Sparkles, GripVertical, Loader2, ChevronRight, Download } from "lucide-react";
import { moveLeadToStage } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import type { Stage, PipelineCard } from "@/lib/data";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { LeadContactActions } from "@/components/app/lead-contact-actions";
import { StageManager } from "@/components/app/stage-manager";

type Board = Record<string, PipelineCard[]>;

export function PipelineBoard({
  workspaceId,
  stages,
  cardsByStage,
  counts,
  cap,
  contactConnected,
  canManage,
}: {
  workspaceId: string;
  stages: Stage[];
  cardsByStage: Board;
  counts: Record<string, number>;
  cap: number;
  contactConnected: boolean;
  canManage: boolean;
}) {
  const [board, setBoard] = useState<Board>(cardsByStage);
  const [count, setCount] = useState<Record<string, number>>(counts);
  const [selected, setSelected] = useState<PipelineCard | null>(null);
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [, startTransition] = useTransition();
  // Near-instant press-and-hold to drag (10ms); a quick click still opens the
  // lead detail. The tiny delay barely distinguishes a tap from a drag, so
  // dragging starts almost immediately.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 10, tolerance: 8 } }),
  );

  function relocate(b: Board, cardId: string, from: string, to: string): Board {
    const card = b[from]?.find((c) => c.id === cardId);
    if (!card) return b;
    return {
      ...b,
      [from]: b[from].filter((c) => c.id !== cardId),
      [to]: [{ ...card, stageId: to }, ...(b[to] ?? [])],
    };
  }

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    for (const list of Object.values(board)) {
      const found = list.find((c) => c.id === id);
      if (found) {
        setActiveCard(found);
        return;
      }
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveCard(null);
    const cardId = String(e.active.id);
    const from = String(e.active.data.current?.stageId ?? "");
    const to = e.over ? String(e.over.id) : "";
    if (!to || !from || from === to) return;

    setBoard((b) => relocate(b, cardId, from, to));
    setCount((c) => ({ ...c, [from]: (c[from] ?? 1) - 1, [to]: (c[to] ?? 0) + 1 }));

    startTransition(async () => {
      const res = await moveLeadToStage(cardId, to);
      if (res.ok) {
        toast.success("Lead moved.");
      } else {
        setBoard((b) => relocate(b, cardId, to, from));
        setCount((c) => ({ ...c, [to]: (c[to] ?? 1) - 1, [from]: (c[from] ?? 0) + 1 }));
        toast.error("Couldn't move the lead. Reverted.");
      }
    });
  }

  // Funnel conversion: a (non-lost) lead at stage N has reached every earlier
  // stage, so "reached" accumulates right-to-left and the rate between two
  // adjacent stages is reached(next) / reached(current). Lost columns sit
  // outside the funnel math.
  const nonLost = stages.filter((s) => s.kind !== "lost");
  const reached = new Map<string, number>();
  for (let i = nonLost.length - 1, sum = 0; i >= 0; i--) {
    sum += count[nonLost[i].id] ?? 0;
    reached.set(nonLost[i].id, sum);
  }
  const conversionAfter = (stage: Stage, next?: Stage): number | null => {
    if (!next || stage.kind === "lost" || next.kind === "lost") return null;
    const from = reached.get(stage.id) ?? 0;
    if (from <= 0) return null;
    return (reached.get(next.id) ?? 0) / from;
  };

  const exportCsv = () => {
    const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    const rows: string[][] = [
      ["Stage", "Type", "Leads", "Reached stage or beyond", "Conversion from previous"],
    ];
    let prev: number | null = null;
    for (const s of stages) {
      const lost = s.kind === "lost";
      const r = lost ? null : (reached.get(s.id) ?? 0);
      const conv =
        !lost && prev != null && prev > 0 && r != null
          ? `${Math.round((r / prev) * 100)}%`
          : "";
      rows.push([s.name, s.kind, String(count[s.id] ?? 0), r != null ? String(r) : "", conv]);
      if (!lost && r != null) prev = r;
    }
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    // BOM so Excel opens the UTF-8 file with accents intact.
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pipeline-stages-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveCard(null)}
    >
      <div className="flex h-[calc(100vh-11rem)] flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Press and hold a card to drag it between stages.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Export CSV
            </Button>
            {canManage && <StageManager workspaceId={workspaceId} stages={stages} />}
          </div>
        </div>

        <div className="board-scroll flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto pb-2">
          {stages.map((stage, i) => {
            const conv = conversionAfter(stage, stages[i + 1]);
            return (
              <div key={stage.id} className="flex h-full min-w-0 shrink-0 gap-3">
                <StageColumn
                  stage={stage}
                  cards={board[stage.id] ?? []}
                  total={count[stage.id] ?? 0}
                  cap={cap}
                  onCardClick={setSelected}
                />
                {conv != null && (
                  <div className="flex shrink-0 flex-col items-center justify-start pt-14">
                    <span
                      className="flex items-center gap-0.5 rounded-full border bg-card px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground shadow-sm"
                      title="Of the leads that reached this stage, how many got to the next one (or beyond)"
                    >
                      {Math.round(conv * 100)}%
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* The dragged card rides above everything, unclipped by the columns. */}
      <DragOverlay dropAnimation={null}>
        {activeCard ? <LeadCardContent card={activeCard} overlay /> : null}
      </DragOverlay>

      <CardDetailSheet
        card={selected}
        stages={stages}
        contactConnected={contactConnected}
        onClose={() => setSelected(null)}
        onMoved={(card, to) => {
          setBoard((b) => relocate(b, card.id, card.stageId ?? "", to));
          setSelected(null);
        }}
      />
    </DndContext>
  );
}

function StageColumn({
  stage,
  cards,
  total,
  cap,
  onCardClick,
}: {
  stage: Stage;
  cards: PipelineCard[];
  total: number;
  cap: number;
  onCardClick: (c: PipelineCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const accent = stage.color ?? "#94a3b8";
  return (
    <div
      className={`flex h-full w-72 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/40 shadow-sm transition-colors ${
        isOver ? "border-primary/60 ring-2 ring-primary/30" : ""
      }`}
    >
      <div className="h-1 w-full shrink-0" style={{ backgroundColor: accent }} />
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="text-sm font-semibold">{stage.name}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {total}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`pipeline-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors ${
          isOver ? "bg-primary/5" : ""
        }`}
      >
        {cards.map((card) => (
          <LeadCard key={card.id} card={card} onClick={() => onCardClick(card)} />
        ))}
        {cards.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No leads here.
          </p>
        )}
        {total > cap && (
          <p className="px-2 pt-1 text-center text-xs text-muted-foreground">
            Showing the {cap} most recent of {total}.
          </p>
        )}
      </div>
    </div>
  );
}

function LeadCard({ card, onClick }: { card: PipelineCard; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { stageId: card.stageId },
  });
  // The original stays in place but dims while its overlay clone is dragged.
  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={`touch-none ${isDragging ? "opacity-40" : ""}`}
      {...listeners}
      {...attributes}
    >
      <LeadCardContent card={card} />
    </div>
  );
}

/** Pure card visuals — reused for the in-column card and the drag overlay. */
function LeadCardContent({
  card,
  overlay = false,
}: {
  card: PipelineCard;
  overlay?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-3 shadow-sm select-none ${
        overlay
          ? "rotate-2 scale-[1.03] cursor-grabbing shadow-2xl ring-2 ring-primary/40"
          : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{card.name}</p>
          <p className="truncate text-xs text-muted-foreground">{card.campaign}</p>
          <div className="mt-2 flex items-center gap-2">
            {card.aiScore != null ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                <Sparkles className="h-3 w-3" />
                {card.aiScore}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Procesando
              </span>
            )}
            {card.phone !== "—" && (
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CardDetailSheet({
  card,
  stages,
  contactConnected,
  onClose,
  onMoved,
}: {
  card: PipelineCard | null;
  stages: Stage[];
  contactConnected: boolean;
  onClose: () => void;
  onMoved: (card: PipelineCard, toStageId: string) => void;
}) {
  const [, startTransition] = useTransition();

  return (
    <Sheet open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        {card && (
          <>
            <SheetHeader>
              <SheetTitle>{card.name}</SheetTitle>
              <SheetDescription>{card.campaign}</SheetDescription>
            </SheetHeader>
            <div className="space-y-6 px-4 pb-6">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Stage
                </label>
                <select
                  value={card.stageId ?? ""}
                  onChange={(e) => {
                    const to = e.target.value;
                    startTransition(async () => {
                      const res = await moveLeadToStage(card.id, to);
                      if (res.ok) {
                        toast.success("Stage updated.");
                        onMoved(card, to);
                      } else {
                        toast.error("Couldn't update the stage.");
                      }
                    });
                  }}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {card.aiScore != null && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    AI Score
                  </p>
                  <div className="flex items-center gap-2">
                    <Progress value={card.aiScore} className="h-1.5" />
                    <span className="text-sm font-medium">{card.aiScore}</span>
                  </div>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Contact
                </p>
                <p className="flex items-center gap-2 text-sm">
                  <Phone className="size-4 shrink-0 text-muted-foreground" />
                  {card.phone !== "—" ? (
                    <a href={`tel:${card.phone}`} className="hover:underline">
                      {card.phone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">No phone</span>
                  )}
                </p>
                <LeadContactActions
                  leadId={card.id}
                  hasPhone={card.phone !== "—"}
                  connected={contactConnected}
                />
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
