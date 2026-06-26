import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  analyzeContract,
  askContract,
  getContract,
  listChat,
} from "@/lib/contracts.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Send,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/contracts/$id")({
  head: () => ({ meta: [{ title: "Contract review · Clausely" }] }),
  component: ContractPage,
});

type Risk = {
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  quote: string;
  explanation: string;
};
type Sla = { priority: string; response_time: string; resolution_time: string };
type Clause = { name: string; present: boolean; summary: string };
type Compliance = { rule: string; status: "pass" | "fail" | "warn"; detail: string };
type Analysis = {
  summary?: string;
  parties?: { customer?: string; vendor?: string };
  duration?: string;
  renewal?: string;
  support_hours?: string;
  slas?: Sla[];
  clauses?: Clause[];
  risks?: Risk[];
  missing?: string[];
  compliance?: Compliance[];
  recommendations?: string[];
  risk_score?: number;
};

function ContractPage() {
  const { id } = Route.useParams();
  const get = useServerFn(getContract);
  const analyze = useServerFn(analyzeContract);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["contract", id],
    queryFn: () => get({ data: { id } }),
    refetchInterval: (query) => {
      const d = query.state.data as { status?: string } | undefined;
      return d?.status === "processing" ? 2500 : false;
    },
  });

  const analyzing = useMutation({
    mutationFn: () => analyze({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contract", id] }),
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) {
    return <div className="max-w-6xl mx-auto p-8 text-muted-foreground">Loading…</div>;
  }
  const c = q.data;
  if (!c) return <div className="max-w-6xl mx-auto p-8">Not found.</div>;
  const a = (c.analysis ?? null) as Analysis | null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="size-3.5" /> All contracts
          </Link>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">{c.title}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            Added {new Date(c.created_at).toLocaleString()}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => analyzing.mutate()}
          disabled={analyzing.isPending || c.status === "processing"}
        >
          {(analyzing.isPending || c.status === "processing") ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="size-4 mr-2" />
          )}
          Re-analyze
        </Button>
      </div>

      {c.status === "error" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            Analysis failed: {c.error ?? "Unknown error"}
          </CardContent>
        </Card>
      )}

      {c.status === "processing" || c.status === "pending" ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Loader2 className="size-6 mx-auto animate-spin text-primary" />
            <div className="font-medium">Analyzing your contract…</div>
            <div className="text-sm text-muted-foreground">
              Extracting clauses, SLAs and risks. This usually takes 15–40 seconds.
            </div>
          </CardContent>
        </Card>
      ) : a ? (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <SummaryCard a={a} />
            <Tabs defaultValue="risks" className="w-full">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="risks">Risks</TabsTrigger>
                <TabsTrigger value="sla">SLA</TabsTrigger>
                <TabsTrigger value="clauses">Clauses</TabsTrigger>
                <TabsTrigger value="compliance">Compliance</TabsTrigger>
                <TabsTrigger value="missing">Missing</TabsTrigger>
              </TabsList>
              <TabsContent value="risks" className="mt-4 space-y-3">
                {(a.risks ?? []).length === 0 ? (
                  <EmptyHint text="No notable risks were detected." />
                ) : (
                  a.risks!.map((r, i) => <RiskCard key={i} r={r} />)
                )}
              </TabsContent>
              <TabsContent value="sla" className="mt-4">
                <SlaTable slas={a.slas ?? []} supportHours={a.support_hours} />
              </TabsContent>
              <TabsContent value="clauses" className="mt-4 space-y-2">
                {(a.clauses ?? []).map((cl, i) => (
                  <div
                    key={i}
                    className="rounded-lg border p-3 flex items-start gap-3 bg-card"
                  >
                    {cl.present ? (
                      <CheckCircle2 className="size-4 text-success mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="size-4 text-destructive mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium">{cl.name}</div>
                      <div className="text-sm text-muted-foreground">{cl.summary}</div>
                    </div>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="compliance" className="mt-4 space-y-2">
                {(a.compliance ?? []).length === 0 ? (
                  <EmptyHint text="No specific compliance checks reported." />
                ) : (
                  a.compliance!.map((cp, i) => (
                    <div key={i} className="rounded-lg border p-3 flex items-start gap-3 bg-card">
                      <ComplianceIcon status={cp.status} />
                      <div>
                        <div className="font-medium">{cp.rule}</div>
                        <div className="text-sm text-muted-foreground">{cp.detail}</div>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>
              <TabsContent value="missing" className="mt-4">
                {(a.missing ?? []).length === 0 ? (
                  <EmptyHint text="No important clauses appear to be missing." />
                ) : (
                  <ul className="rounded-lg border divide-y bg-card">
                    {a.missing!.map((m, i) => (
                      <li key={i} className="p-3 flex items-center gap-2">
                        <AlertTriangle className="size-4 text-warning" /> {m}
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>

            {(a.recommendations ?? []).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sparkles className="size-4 text-primary" /> Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm list-disc pl-5">
                    {a.recommendations!.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <RiskGauge score={a.risk_score ?? 0} />
            <KeyFactsCard a={a} />
            <ChatPanel contractId={id} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground italic">{text}</div>;
}

function ComplianceIcon({ status }: { status: "pass" | "fail" | "warn" }) {
  if (status === "pass") return <CheckCircle2 className="size-4 text-success mt-0.5 shrink-0" />;
  if (status === "fail") return <XCircle className="size-4 text-destructive mt-0.5 shrink-0" />;
  return <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />;
}

function SummaryCard({ a }: { a: Analysis }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Executive summary</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
          {a.summary ?? "No summary available."}
        </p>
      </CardContent>
    </Card>
  );
}

function KeyFactsCard({ a }: { a: Analysis }) {
  const facts = [
    ["Customer", a.parties?.customer],
    ["Vendor", a.parties?.vendor],
    ["Duration", a.duration],
    ["Renewal", a.renewal],
    ["Support hours", a.support_hours],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Key facts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {facts.length === 0 && <div className="text-muted-foreground">Not specified.</div>}
        {facts.map(([k, v]) => (
          <div key={k} className="grid grid-cols-3 gap-2">
            <div className="text-muted-foreground">{k}</div>
            <div className="col-span-2 font-medium">{v}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RiskGauge({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const color =
    pct >= 75
      ? "var(--risk-critical)"
      : pct >= 50
        ? "var(--risk-high)"
        : pct >= 25
          ? "var(--risk-medium)"
          : "var(--risk-low)";
  const label =
    pct >= 75 ? "Critical" : pct >= 50 ? "High" : pct >= 25 ? "Medium" : "Low";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="size-4" /> Risk score
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-4xl font-semibold" style={{ color }}>
            {pct}
          </div>
          <div className="text-sm text-muted-foreground">/ 100 · {label}</div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
      </CardContent>
    </Card>
  );
}

function RiskCard({ r }: { r: Risk }) {
  const tone: Record<Risk["severity"], string> = {
    critical: "border-l-[var(--risk-critical)] bg-destructive/5",
    high: "border-l-[var(--risk-high)] bg-warning/10",
    medium: "border-l-[var(--risk-medium)] bg-warning/5",
    low: "border-l-[var(--risk-low)] bg-success/5",
  };
  return (
    <div className={`rounded-lg border border-l-4 p-4 bg-card ${tone[r.severity]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">{r.title}</div>
        <span
          className="text-xs uppercase tracking-wide font-semibold"
          style={{ color: `var(--risk-${r.severity})` }}
        >
          {r.severity}
        </span>
      </div>
      {r.quote && (
        <blockquote className="mt-2 text-sm italic border-l-2 pl-3 text-muted-foreground">
          "{r.quote}"
        </blockquote>
      )}
      <p className="text-sm mt-2">{r.explanation}</p>
    </div>
  );
}

function SlaTable({ slas, supportHours }: { slas: Sla[]; supportHours?: string }) {
  if (slas.length === 0) {
    return <EmptyHint text="No SLA table detected." />;
  }
  return (
    <Card>
      <CardContent className="p-0 overflow-hidden">
        {supportHours && (
          <div className="px-4 py-3 border-b text-sm bg-muted/40">
            <span className="text-muted-foreground">Support hours:</span>{" "}
            <span className="font-medium">{supportHours}</span>
          </div>
        )}
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-4 py-2">Priority</th>
              <th className="text-left font-medium px-4 py-2">Response</th>
              <th className="text-left font-medium px-4 py-2">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {slas.map((s, i) => (
              <tr key={i} className="border-t">
                <td className="px-4 py-2 font-medium">{s.priority}</td>
                <td className="px-4 py-2">{s.response_time}</td>
                <td className="px-4 py-2">{s.resolution_time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function ChatPanel({ contractId }: { contractId: string }) {
  const list = useServerFn(listChat);
  const ask = useServerFn(askContract);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = useQuery({
    queryKey: ["chat", contractId],
    queryFn: () => list({ data: { id: contractId } }),
  });

  const mut = useMutation({
    mutationFn: (question: string) => ask({ data: { id: contractId, question } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat", contractId] }),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.data, mut.isPending]);

  function send() {
    const v = q.trim();
    if (!v) return;
    setQ("");
    mut.mutate(v);
  }

  return (
    <Card className="flex flex-col h-[28rem]">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="size-4" /> Ask this contract
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3 p-3 pt-0 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1 space-y-2">
          {(messages.data ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground p-3 rounded-lg bg-muted/40">
              Try: <em>"What's the renewal period?"</em> or{" "}
              <em>"What happens if SLA is violated?"</em>
            </div>
          )}
          {(messages.data ?? []).map((m) => (
            <div
              key={m.id}
              className={`text-sm rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground ml-auto"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {m.content}
            </div>
          ))}
          {mut.isPending && (
            <div className="text-sm bg-secondary rounded-lg px-3 py-2 inline-flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about clauses, SLAs, penalties…"
          />
          <Button size="icon" onClick={send} disabled={mut.isPending || !q.trim()}>
            <Send className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
