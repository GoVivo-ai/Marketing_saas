import { renderToBuffer } from "@react-pdf/renderer";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AgentPerformanceRow } from "@/lib/agent-report";

/**
 * Printable Agent Activity report, rendered server-side with
 * @react-pdf/renderer (no browser involved). Page 1: KPIs + charts (drawn
 * with plain Views — stacked channel bars, won/lost bars, daily columns,
 * outcome distribution). Page 2: the per-agent table. Channel hues are the
 * same validated colorblind-safe set the on-screen charts use.
 */

const NAVY = "#0f2744";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const TRACK = "#f1f5f9";
const GREEN = "#047a52";
const RED = "#b91c1c";

const CHANNELS = [
  { key: "call", label: "Calls", color: "#1d4ed8" },
  { key: "sms", label: "SMS", color: "#0d9488" },
  { key: "whatsapp", label: "WhatsApp", color: "#b45309" },
  { key: "email", label: "Email", color: "#9333ea" },
] as const;

const OUTCOME_LABELS: Record<string, string> = {
  answered: "Answered",
  replied: "Replied",
  no_answer: "No answer",
  voicemail: "Voicemail",
  sent: "Sent",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#0f172a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: NAVY },
  subtitle: { fontSize: 10, color: MUTED, marginTop: 3 },
  brand: { fontSize: 11, fontFamily: "Helvetica-Bold", color: NAVY },
  rule: { borderBottomWidth: 2, borderBottomColor: NAVY, marginVertical: 10 },
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  kpi: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 8, color: MUTED, marginBottom: 3 },
  kpiValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },
  chartsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  chartCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    padding: 10,
  },
  chartTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: NAVY },
  chartSub: { fontSize: 7.5, color: MUTED, marginTop: 2, marginBottom: 8 },
  legendRow: { flexDirection: "row", gap: 10, marginBottom: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 7.5, color: MUTED },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  barName: { width: 78, fontSize: 8, paddingRight: 6 },
  barTrack: {
    flex: 1,
    height: 9,
    backgroundColor: TRACK,
    borderRadius: 2,
    flexDirection: "row",
    overflow: "hidden",
  },
  barValue: { width: 30, fontSize: 8, textAlign: "right", color: MUTED },
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 4,
    marginBottom: 2,
  },
  thCell: { fontFamily: "Helvetica-Bold", fontSize: 8, color: NAVY },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 5,
    alignItems: "center",
  },
  outcomeLine: { fontSize: 7.5, color: MUTED, marginTop: 2 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: MUTED,
  },
});

const W = {
  name: 22, calls: 8, answered: 9, talk: 9, other: 8,
  touches: 8, worked: 9, won: 9, first: 9, channels: 9,
};

const fmtTalkTime = (sec: number): string => {
  if (sec === 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const fmtLatency = (min: number | null): string => {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 60 * 24) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / (60 * 24))}d`;
};

const shortName = (full: string): string => {
  const [first, second] = (full || "Unknown").split(/\s+/);
  return second ? `${first} ${second[0]}.` : first;
};

const touchesOf = (r: AgentPerformanceRow) =>
  r.touches.call + r.touches.sms + r.touches.whatsapp + r.touches.email;

export interface AgentActivityPdfData {
  workspaceName: string;
  periodLabel: string;
  generatedAt: Date;
  rows: AgentPerformanceRow[];
  daily: { day: string; touches: number; calls: number }[];
}

// ── Chart pieces ───────────────────────────────────────────────────────────

function ChannelLegend() {
  return (
    <View style={styles.legendRow}>
      {CHANNELS.map((c) => (
        <View key={c.key} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: c.color }]} />
          <Text style={styles.legendText}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Horizontal stacked bar per agent, one segment per channel. */
function TouchesChart({ rows }: { rows: AgentPerformanceRow[] }) {
  const max = Math.max(...rows.map(touchesOf), 1);
  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>Touches by agent</Text>
      <Text style={styles.chartSub}>Outreach logged in the app, by channel</Text>
      <ChannelLegend />
      {rows.map((r) => (
        <View key={r.userId} style={styles.barRow}>
          <Text style={styles.barName}>{shortName(r.name)}</Text>
          <View style={styles.barTrack}>
            {CHANNELS.map((c) =>
              r.touches[c.key] > 0 ? (
                <View
                  key={c.key}
                  style={{
                    width: `${(r.touches[c.key] / max) * 100}%`,
                    backgroundColor: c.color,
                    marginRight: 1,
                  }}
                />
              ) : null,
            )}
          </View>
          <Text style={styles.barValue}>{touchesOf(r)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Two thin bars per agent — won (green) and lost (red) on a shared scale. */
function WonLostChart({ rows }: { rows: AgentPerformanceRow[] }) {
  const max = Math.max(...rows.map((r) => Math.max(r.won, r.lost)), 1);
  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>Won / Lost by agent</Text>
      <Text style={styles.chartSub}>
        Closed leads credited to the last agent who touched them
      </Text>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: GREEN }]} />
          <Text style={styles.legendText}>Won</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: RED }]} />
          <Text style={styles.legendText}>Lost</Text>
        </View>
      </View>
      {rows.map((r) => (
        <View key={r.userId} style={{ marginBottom: 6 }}>
          <View style={[styles.barRow, { marginBottom: 2 }]}>
            <Text style={styles.barName}>{shortName(r.name)}</Text>
            <View style={styles.barTrack}>
              <View
                style={{
                  width: `${(r.won / max) * 100}%`,
                  backgroundColor: GREEN,
                  borderTopRightRadius: 2,
                  borderBottomRightRadius: 2,
                }}
              />
            </View>
            <Text style={styles.barValue}>{r.won}</Text>
          </View>
          <View style={styles.barRow}>
            <Text style={styles.barName} />
            <View style={styles.barTrack}>
              <View
                style={{
                  width: `${(r.lost / max) * 100}%`,
                  backgroundColor: RED,
                  borderTopRightRadius: 2,
                  borderBottomRightRadius: 2,
                }}
              />
            </View>
            <Text style={styles.barValue}>{r.lost}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/** Daily column chart of touches (navy) across the period. */
function DailyChart({
  daily,
}: {
  daily: { day: string; touches: number; calls: number }[];
}) {
  const max = Math.max(...daily.map((d) => d.touches + d.calls), 1);
  const H = 72;
  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>Daily activity</Text>
      <Text style={styles.chartSub}>
        Touches and RingCentral calls per day · peak {max}/day
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          height: H,
          borderBottomWidth: 0.5,
          borderBottomColor: BORDER,
        }}
      >
        {daily.map((d) => (
          <View
            key={d.day}
            style={{
              flex: 1,
              marginRight: 1,
              justifyContent: "flex-end",
              height: H,
            }}
          >
            {d.calls > 0 ? (
              <View
                style={{
                  height: Math.max((d.calls / max) * H, 1),
                  backgroundColor: "#0d9488",
                }}
              />
            ) : null}
            <View
              style={{
                height: d.touches > 0 ? Math.max((d.touches / max) * H, 1) : 0,
                backgroundColor: "#1d4ed8",
                borderTopLeftRadius: 1,
                borderTopRightRadius: 1,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 3 }}>
        <Text style={styles.legendText}>{daily[0]?.day ?? ""}</Text>
        <Text style={styles.legendText}>{daily[daily.length - 1]?.day ?? ""}</Text>
      </View>
    </View>
  );
}

/** Team-wide outcome distribution as single-hue bars with counts. */
function OutcomesChart({ rows }: { rows: AgentPerformanceRow[] }) {
  const totals = new Map<string, number>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r.outcomes))
      totals.set(k, (totals.get(k) ?? 0) + v);
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] ?? 1;
  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>Outcome distribution</Text>
      <Text style={styles.chartSub}>What happened across every logged touch</Text>
      {entries.length === 0 ? (
        <Text style={{ fontSize: 8, color: MUTED }}>No outcomes recorded.</Text>
      ) : (
        entries.map(([k, v]) => (
          <View key={k} style={styles.barRow}>
            <Text style={[styles.barName, { width: 64 }]}>
              {OUTCOME_LABELS[k] ?? k}
            </Text>
            <View style={styles.barTrack}>
              <View
                style={{
                  width: `${(v / max) * 100}%`,
                  backgroundColor: NAVY,
                  borderTopRightRadius: 2,
                  borderBottomRightRadius: 2,
                }}
              />
            </View>
            <Text style={styles.barValue}>{v}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function Footer({ generatedAt }: { generatedAt: Date }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        Generated {generatedAt.toISOString().slice(0, 10)} · Won/Lost credits
        the last agent who touched the lead
      </Text>
      <Text
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}

// ── Document ───────────────────────────────────────────────────────────────

function AgentActivityPdf({ data }: { data: AgentActivityPdfData }) {
  const totals = {
    rcCalls: data.rows.reduce((n, r) => n + r.rcCalls, 0),
    talk: data.rows.reduce((n, r) => n + r.rcTalkTimeSec, 0),
    touches: data.rows.reduce((n, r) => n + touchesOf(r), 0),
    worked: data.rows.reduce((n, r) => n + r.leadsWorked, 0),
    won: data.rows.reduce((n, r) => n + r.won, 0),
    lost: data.rows.reduce((n, r) => n + r.lost, 0),
  };

  const header = (
    <>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Agent Activity Report</Text>
          <Text style={styles.subtitle}>
            {data.workspaceName} · {data.periodLabel}
          </Text>
        </View>
        <Text style={styles.brand}>VIVO Marketing OS</Text>
      </View>
      <View style={styles.rule} />
    </>
  );

  return (
    <Document
      title={`Agent Activity — ${data.workspaceName}`}
      author="Vivo Marketing OS"
    >
      {/* ── Page 1: KPIs + charts ─────────────────────────────────────── */}
      <Page size="A4" orientation="landscape" style={styles.page}>
        {header}
        <View style={styles.kpiRow}>
          {[
            ["Agents", String(data.rows.length)],
            ["RingCentral calls", String(totals.rcCalls)],
            ["Talk time", fmtTalkTime(totals.talk)],
            ["Touches", String(totals.touches)],
            ["Leads worked", String(totals.worked)],
            ["Won / Lost", `${totals.won} / ${totals.lost}`],
          ].map(([label, value]) => (
            <View key={label} style={styles.kpi}>
              <Text style={styles.kpiLabel}>{label}</Text>
              <Text style={styles.kpiValue}>{value}</Text>
            </View>
          ))}
        </View>
        <View style={styles.chartsRow}>
          <TouchesChart rows={data.rows} />
          <OutcomesChart rows={data.rows} />
        </View>
        <View style={styles.chartsRow}>
          {data.daily.length > 1 ? <DailyChart daily={data.daily} /> : null}
          <WonLostChart rows={data.rows} />
        </View>
        <Footer generatedAt={data.generatedAt} />
      </Page>

      {/* ── Page 2: per-agent table ───────────────────────────────────── */}
      <Page size="A4" orientation="landscape" style={styles.page}>
        {header}
        <View style={styles.th} fixed>
          <Text style={[styles.thCell, { width: `${W.name}%` }]}>Agent</Text>
          <Text style={[styles.thCell, { width: `${W.calls}%` }]}>RC calls</Text>
          <Text style={[styles.thCell, { width: `${W.answered}%` }]}>Answered</Text>
          <Text style={[styles.thCell, { width: `${W.talk}%` }]}>Talk time</Text>
          <Text style={[styles.thCell, { width: `${W.other}%` }]}>Other calls</Text>
          <Text style={[styles.thCell, { width: `${W.touches}%` }]}>Touches</Text>
          <Text style={[styles.thCell, { width: `${W.worked}%` }]}>Leads worked</Text>
          <Text style={[styles.thCell, { width: `${W.won}%` }]}>Won / Lost</Text>
          <Text style={[styles.thCell, { width: `${W.first}%` }]}>First touch</Text>
          <Text style={[styles.thCell, { width: `${W.channels}%` }]}>Channels</Text>
        </View>
        {data.rows.map((r) => {
          const outcomes = Object.entries(r.outcomes)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${v} ${(OUTCOME_LABELS[k] ?? k).toLowerCase()}`)
            .join(" · ");
          return (
            <View key={r.userId} style={styles.tr} wrap={false}>
              <View style={{ width: `${W.name}%`, paddingRight: 10 }}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>
                  {r.name || "Unknown user"}
                </Text>
                {outcomes ? (
                  <Text style={styles.outcomeLine}>{outcomes}</Text>
                ) : null}
              </View>
              <Text style={{ width: `${W.calls}%` }}>{r.rcCalls}</Text>
              <Text style={{ width: `${W.answered}%` }}>
                {r.rcCalls > 0
                  ? `${Math.round((r.rcConnected / r.rcCalls) * 100)}%`
                  : "—"}
              </Text>
              <Text style={{ width: `${W.talk}%` }}>
                {fmtTalkTime(r.rcTalkTimeSec)}
              </Text>
              <Text style={{ width: `${W.other}%` }}>
                {r.rcOtherCalls || "—"}
              </Text>
              <Text style={{ width: `${W.touches}%` }}>{touchesOf(r)}</Text>
              <Text style={{ width: `${W.worked}%` }}>{r.leadsWorked}</Text>
              <Text style={{ width: `${W.won}%` }}>
                <Text style={{ color: GREEN }}>{r.won}</Text>
                {" / "}
                <Text style={{ color: RED }}>{r.lost}</Text>
              </Text>
              <Text style={{ width: `${W.first}%` }}>
                {fmtLatency(r.medianFirstTouchMin)}
              </Text>
              <Text style={{ width: `${W.channels}%`, fontSize: 7.5 }}>
                {`${r.touches.call}c ${r.touches.sms}s ${r.touches.whatsapp}w ${r.touches.email}e`}
              </Text>
            </View>
          );
        })}
        <Footer generatedAt={data.generatedAt} />
      </Page>
    </Document>
  );
}

export function renderAgentActivityPdf(
  data: AgentActivityPdfData,
): Promise<Buffer> {
  return renderToBuffer(<AgentActivityPdf data={data} />);
}
