import { renderToBuffer } from "@react-pdf/renderer";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AgentPerformanceRow } from "@/lib/agent-report";

/**
 * Printable Agent Activity report. Rendered server-side with
 * @react-pdf/renderer (no browser involved), one landscape A4 page per ~12
 * agents. Mirrors the columns of the on-screen table.
 */

const NAVY = "#0f2744";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const GREEN = "#047a52";
const RED = "#b91c1c";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
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
  kpi: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    padding: 8,
  },
  kpiLabel: { fontSize: 8, color: MUTED, marginBottom: 3 },
  kpiValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },
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

// Column widths (%) — name gets the slack.
const W = {
  name: 22,
  calls: 8,
  answered: 9,
  talk: 9,
  other: 8,
  touches: 8,
  worked: 9,
  won: 9,
  first: 9,
  channels: 9,
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

const OUTCOME_LABELS: Record<string, string> = {
  answered: "answered",
  no_answer: "no answer",
  voicemail: "voicemail",
  replied: "replied",
  sent: "sent",
  not_interested: "not interested",
  wrong_number: "wrong number",
};

export interface AgentActivityPdfData {
  workspaceName: string;
  periodLabel: string;
  generatedAt: Date;
  rows: AgentPerformanceRow[];
}

function AgentActivityPdf({ data }: { data: AgentActivityPdfData }) {
  const totals = {
    rcCalls: data.rows.reduce((n, r) => n + r.rcCalls, 0),
    talk: data.rows.reduce((n, r) => n + r.rcTalkTimeSec, 0),
    touches: data.rows.reduce(
      (n, r) =>
        n + r.touches.call + r.touches.sms + r.touches.whatsapp + r.touches.email,
      0,
    ),
    worked: data.rows.reduce((n, r) => n + r.leadsWorked, 0),
    won: data.rows.reduce((n, r) => n + r.won, 0),
    lost: data.rows.reduce((n, r) => n + r.lost, 0),
  };

  return (
    <Document
      title={`Agent Activity — ${data.workspaceName}`}
      author="Vivo Marketing OS"
    >
      <Page size="A4" orientation="landscape" style={styles.page}>
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
          const touches =
            r.touches.call + r.touches.sms + r.touches.whatsapp + r.touches.email;
          const outcomes = Object.entries(r.outcomes)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${v} ${OUTCOME_LABELS[k] ?? k}`)
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
              <Text style={{ width: `${W.touches}%` }}>{touches}</Text>
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

        <View style={styles.footer} fixed>
          <Text>
            Generated {data.generatedAt.toISOString().slice(0, 10)} · Won/Lost
            credits the last agent who touched the lead
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export function renderAgentActivityPdf(
  data: AgentActivityPdfData,
): Promise<Buffer> {
  return renderToBuffer(<AgentActivityPdf data={data} />);
}
