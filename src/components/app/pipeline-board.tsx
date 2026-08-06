"use client";

import { useEffect, useState, useTransition } from "react";
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
import {
  Phone,
  Sparkles,
  GripVertical,
  Loader2,
  ChevronRight,
  Download,
} from "lucide-react";
import { moveLeadToStage, getLeadDetail } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";
import type { Stage, PipelineCard, LeadRow } from "@/lib/data";
import { LeadDetailSheet } from "@/components/app/lead-detail-sheet";
import { StageManager } from "@/components/app/stage-manager";

type Board = Record<string, PipelineCard[]>;

export function PipelineBoard({
  workspaceId,
  stages,
  cardsByStage,
  counts,
  cap,
  canManage,
}: {
  workspaceId: string;
  stages: Stage[];
  cardsByStage: Board;
  counts: Record<string, number>;
  cap: number;
  canManage: boolean;
}) {
  const [board, setBoard] = useState<Board>(cardsByStage);
  const [count, setCount] = useState<Record<string, number>>(counts);
  // Clicking a card opens THE lead detail (same sheet as the Leads table),
  // fetched on demand so the board payload stays light.
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fresh server data (auto-refresh polling, another agent's action) flows
  // into the board — except mid-drag or while a move is saving, where the
  // optimistic layout wins until the server confirms.
  useEffect(() => {
    if (activeCard || isPending) return;
    setBoard(cardsByStage);
    setCount(counts);
  }, [cardsByStage, counts, activeCard, isPending]);

  const openDetail = (card: PipelineCard) => {
    setOpeningId(card.id);
    startTransition(async () => {
      try {
        const row = await getLeadDetail(card.id);
        if (row) setSelected(row);
        else toast.error("Couldn't load the lead detail.");
      } catch {
        toast.error("Couldn't load the lead detail.");
      } finally {
        setOpeningId(null);
      }
    });
  };
  // Distance-based activation: a plain click (no movement) opens the lead
  // detail; dragging starts only after the pointer moves a few pixels. The
  // old tiny press-delay turned nearly every click into a micro-drag, which
  // swallowed the click and made the detail sheet unreachable.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
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
  const conversionFromPrev = (stage: Stage, prev?: Stage): number | null => {
    if (!prev || stage.kind === "lost" || prev.kind === "lost") return null;
    const from = reached.get(prev.id) ?? 0;
    if (from <= 0) return null;
    return (reached.get(stage.id) ?? 0) / from;
  };

  // Small rates matter here (e.g. 0.4% to Won) — keep a decimal under 10%.
  const fmtPct = (frac: number) => {
    const v = frac * 100;
    return v >= 10 || v === 0 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`;
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
        !lost && prev != null && prev > 0 && r != null ? fmtPct(r / prev) : "";
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
            Drag a card by its ⋮⋮ handle to move it between stages — click
            anywhere else on the card to open the lead.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Export CSV
            </Button>
            {canManage && <StageManager workspaceId={workspaceId} stages={stages} />}
          </div>
        </div>

        <div className="board-scroll flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto pb-2">
          {stages.map((stage, i) => {
            const conv = conversionFromPrev(stage, stages[i - 1]);
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                cards={board[stage.id] ?? []}
                total={count[stage.id] ?? 0}
                cap={cap}
                conversion={conv != null ? fmtPct(conv) : null}
                onCardClick={openDetail}
                openingId={openingId}
              />
            );
          })}
        </div>
      </div>

      {/* The dragged card rides above everything, unclipped by the columns. */}
      <DragOverlay dropAnimation={null}>
        {activeCard ? <LeadCardContent card={activeCard} overlay /> : null}
      </DragOverlay>

      <LeadDetailSheet
        lead={selected}
        onClose={() => setSelected(null)}
        onPatch={(patch) =>
          setSelected((cur) => (cur ? { ...cur, ...patch } : cur))
        }
      />
    </DndContext>
  );
}

function StageColumn({
  stage,
  cards,
  total,
  cap,
  conversion,
  onCardClick,
  openingId,
}: {
  stage: Stage;
  cards: PipelineCard[];
  total: number;
  cap: number;
  /** Formatted conversion rate from the previous stage (null on the first). */
  conversion: string | null;
  onCardClick: (c: PipelineCard) => void;
  /** Card whose detail is currently being fetched (shows a spinner). */
  openingId: string | null;
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
      <div className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <span className="text-sm font-semibold">{stage.name}</span>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {total}
          </span>
        </div>
        {conversion && (
          <p
            className="mt-0.5 pl-[18px] text-[11px] tabular-nums text-muted-foreground"
            title="Of the leads that reached the previous stage, how many got here (or beyond)"
          >
            <ChevronRight className="mr-0.5 inline h-3 w-3" />
            {conversion} from previous stage
          </p>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`pipeline-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 transition-colors ${
          isOver ? "bg-primary/5" : ""
        }`}
      >
        {cards.map((card) => (
          <LeadCard
            key={card.id}
            card={card}
            opening={openingId === card.id}
            onClick={() => onCardClick(card)}
          />
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

function LeadCard({
  card,
  onClick,
  opening = false,
}: {
  card: PipelineCard;
  onClick: () => void;
  opening?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { stageId: card.stageId },
  });
  // Dragging happens ONLY from the grip handle; the rest of the card is a
  // plain click target that opens the lead detail — so the cursor tells the
  // truth: grab on the handle, pointer everywhere else.
  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={`cursor-pointer ${isDragging ? "opacity-40" : ""} ${
        opening ? "animate-pulse" : ""
      }`}
    >
      <LeadCardContent
        card={card}
        dragHandle={
          <span
            {...listeners}
            {...attributes}
            onClick={(e) => e.stopPropagation()}
            title="Drag to move"
            className="-m-1 touch-none rounded p-1 cursor-grab active:cursor-grabbing hover:bg-muted"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground/60" />
          </span>
        }
      />
    </div>
  );
}

/** Pure card visuals — reused for the in-column card and the drag overlay. */
function LeadCardContent({
  card,
  overlay = false,
  dragHandle,
}: {
  card: PipelineCard;
  overlay?: boolean;
  dragHandle?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-3 shadow-sm select-none ${
        overlay
          ? "rotate-2 scale-[1.03] cursor-grabbing shadow-2xl ring-2 ring-primary/40"
          : ""
      }`}
    >
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 shrink-0">
          {dragHandle ?? (
            <GripVertical className="h-4 w-4 text-muted-foreground/40" />
          )}
        </span>
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
