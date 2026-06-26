import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  createContract,
  listContracts,
  analyzeContract,
  deleteContract,
} from "@/lib/contracts.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Upload,
  Loader2,
  FileText,
  Trash2,
  Plus,
  ShieldAlert,
  CheckCircle2,
  Clock3,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [{ title: "Your contracts · Clausely" }],
  }),
  component: Dashboard,
});

function Dashboard() {
  const list = useServerFn(listContracts);
  const q = useQuery({ queryKey: ["contracts"], queryFn: () => list() });
  const router = useRouter();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Support contracts</h1>
        <p className="text-muted-foreground max-w-2xl">
          Upload SLAs, maintenance agreements and service contracts. Clausely extracts SLAs, flags
          risky terms, finds missing clauses and lets you ask questions in plain English.
        </p>
        <UploadDialog onCreated={() => router.invalidate()} />
      </section>

      <section>
        {q.isLoading ? (
          <SkeletonGrid />
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(q.data ?? []).map((c) => (
              <ContractCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type ContractRow = Awaited<ReturnType<typeof listContracts>>[number];

function ContractCard({ c }: { c: ContractRow }) {
  const del = useServerFn(deleteContract);
  const qc = useQueryClient();
  const analyze = useServerFn(analyzeContract);
  const analyzing = useMutation({
    mutationFn: () => analyze({ data: { id: c.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contracts"] }),
    onError: (e) => toast.error(e.message),
  });

  const a = (c.analysis ?? null) as null | { risk_score?: number; summary?: string };
  const score = typeof a?.risk_score === "number" ? a.risk_score : null;

  return (
    <Card className="group relative overflow-hidden border-border/60 hover:shadow-soft transition-shadow">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            to="/contracts/$id"
            params={{ id: c.id }}
            className="flex items-start gap-3 min-w-0 flex-1"
          >
            <div className="size-10 rounded-lg bg-secondary text-secondary-foreground grid place-items-center shrink-0">
              <FileText className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{c.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {new Date(c.created_at).toLocaleDateString()}
              </div>
            </div>
          </Link>
          <StatusPill status={c.status} />
        </div>

        {a?.summary ? (
          <p className="text-sm text-muted-foreground line-clamp-3">{a.summary}</p>
        ) : c.status === "pending" ? (
          <p className="text-sm text-muted-foreground">Not analyzed yet.</p>
        ) : c.status === "processing" ? (
          <p className="text-sm text-muted-foreground">Analyzing your contract…</p>
        ) : null}

        <div className="flex items-center justify-between">
          <div>
            {score !== null && (
              <div className="flex items-center gap-2 text-sm">
                <ShieldAlert className="size-4 text-muted-foreground" />
                Risk{" "}
                <span
                  className="font-semibold"
                  style={{
                    color:
                      score >= 75
                        ? "var(--risk-critical)"
                        : score >= 50
                          ? "var(--risk-high)"
                          : score >= 25
                            ? "var(--risk-medium)"
                            : "var(--risk-low)",
                  }}
                >
                  {score}/100
                </span>
              </div>
            )}
          </div>
          <div className="flex gap-1">
            {(c.status === "pending" || c.status === "error") && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => analyzing.mutate()}
                disabled={analyzing.isPending}
              >
                {analyzing.isPending && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
                Analyze
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={async () => {
                if (!confirm("Delete this contract?")) return;
                await del({ data: { id: c.id } });
                qc.invalidateQueries({ queryKey: ["contracts"] });
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { icon: React.ElementType; label: string; cls: string }> = {
    pending: { icon: Clock3, label: "Pending", cls: "bg-muted text-muted-foreground" },
    processing: { icon: Loader2, label: "Analyzing", cls: "bg-secondary text-secondary-foreground" },
    ready: { icon: CheckCircle2, label: "Reviewed", cls: "bg-success/15 text-success" },
    error: { icon: AlertCircle, label: "Error", cls: "bg-destructive/15 text-destructive" },
  };
  const m = map[status] ?? map.pending;
  const Icon = m.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${m.cls}`}
    >
      <Icon className={`size-3 ${status === "processing" ? "animate-spin" : ""}`} />
      {m.label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed py-16 text-center">
      <div className="mx-auto size-12 rounded-full bg-secondary grid place-items-center mb-4">
        <FileText className="size-6 text-secondary-foreground" />
      </div>
      <h2 className="font-semibold text-lg">No contracts yet</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Upload your first SLA or service agreement to get started.
      </p>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-44 rounded-xl bg-muted/60 animate-pulse" />
      ))}
    </div>
  );
}

function UploadDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const create = useServerFn(createContract);
  const analyze = useServerFn(analyzeContract);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function handleUpload(mode: "upload" | "paste") {
    if (!title.trim()) return toast.error("Add a title");
    if (mode === "upload" && !file) return toast.error("Choose a file");
    if (mode === "paste" && text.trim().length < 30)
      return toast.error("Paste at least 30 characters of text");
    setLoading(true);
    try {
      let file_path: string | undefined;
      let file_type: string | undefined;
      if (mode === "upload" && file) {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("Not signed in");
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${uid}/${crypto.randomUUID()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("contracts")
          .upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (upErr) throw upErr;
        file_path = path;
        file_type = file.type;
      }
      const row = await create({
        data: {
          title: title.trim(),
          source_kind: mode,
          file_path,
          file_type,
          pasted_text: mode === "paste" ? text : undefined,
        },
      });
      setOpen(false);
      setTitle("");
      setFile(null);
      setText("");
      onCreated();
      qc.invalidateQueries({ queryKey: ["contracts"] });
      navigate({ to: "/contracts/$id", params: { id: row.id } });
      // Kick off analysis in background.
      analyze({ data: { id: row.id } })
        .then(() => qc.invalidateQueries({ queryKey: ["contracts"] }))
        .catch((e) => toast.error(e.message));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="shadow-glow">
          <Plus className="size-4 mr-1.5" /> New contract
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a contract</DialogTitle>
          <DialogDescription>
            Upload a PDF, DOCX, image or scanned document — or paste the text directly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ct">Title</Label>
            <Input
              id="ct"
              placeholder="ACME Support Agreement 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <Tabs defaultValue="file">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="file">File</TabsTrigger>
              <TabsTrigger value="text">Paste text</TabsTrigger>
            </TabsList>
            <TabsContent value="file" className="mt-3">
              <label className="block rounded-xl border-2 border-dashed p-6 text-center cursor-pointer hover:border-primary/50 transition-colors">
                <Upload className="size-6 mx-auto text-muted-foreground" />
                <div className="text-sm mt-2 font-medium">
                  {file ? file.name : "Click to choose a file"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  PDF, DOCX, TXT, PNG, JPG · scanned PDFs supported
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,application/pdf,image/*,text/plain"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <DialogFooter className="mt-4">
                <Button onClick={() => handleUpload("upload")} disabled={loading}>
                  {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
                  Upload & analyze
                </Button>
              </DialogFooter>
            </TabsContent>
            <TabsContent value="text" className="mt-3">
              <Textarea
                rows={10}
                placeholder="Paste the full contract text here…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <DialogFooter className="mt-4">
                <Button onClick={() => handleUpload("paste")} disabled={loading}>
                  {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
                  Save & analyze
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { Badge };
