import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CreateInput = z.object({
  title: z.string().min(1).max(200),
  source_kind: z.enum(["upload", "paste"]),
  file_path: z.string().optional(),
  file_type: z.string().optional(),
  pasted_text: z.string().optional(),
});

export const createContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const insert = {
      user_id: userId,
      title: data.title,
      source_kind: data.source_kind,
      file_path: data.file_path ?? null,
      file_type: data.file_type ?? null,
      extracted_text: data.source_kind === "paste" ? (data.pasted_text ?? "") : null,
      status: "pending" as const,
    };
    const { data: row, error } = await supabase
      .from("contracts")
      .insert(insert)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listContracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("contracts")
      .select("id,title,status,created_at,analysis,file_type,source_kind")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("contracts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Not found");
    return row;
  });

export const deleteContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("contracts")
      .select("file_path")
      .eq("id", data.id)
      .maybeSingle();
    if (row?.file_path) {
      await context.supabase.storage.from("contracts").remove([row.file_path]);
    }
    const { error } = await context.supabase.from("contracts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const ANALYSIS_SYSTEM = `You are an expert support-contract reviewer (SLAs, maintenance & service agreements).
You will receive contract text. Return a single JSON object that exactly matches this TypeScript shape (no markdown, no commentary):
{
  "summary": string,                          // 6-10 sentence executive summary
  "parties": { "customer": string, "vendor": string },
  "duration": string,
  "renewal": string,
  "support_hours": string,
  "slas": Array<{ "priority": string, "response_time": string, "resolution_time": string }>,
  "clauses": Array<{ "name": string, "present": boolean, "summary": string }>,  // include: Support Hours, Response Time, Resolution Time, Penalty, Renewal, Termination, Warranty, Confidentiality, Payment, Escalation, Data Privacy, Liability
  "risks": Array<{ "severity": "critical"|"high"|"medium"|"low", "title": string, "quote": string, "explanation": string }>,
  "missing": string[],                        // important clauses that appear to be missing
  "compliance": Array<{ "rule": string, "status": "pass"|"fail"|"warn", "detail": string }>,
  "recommendations": string[],
  "risk_score": number                         // 0-100, higher = riskier
}
If a field is unknown say "Not specified". Use the exact JSON shape; arrays may be empty.`;

export const analyzeContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Not found");

    await supabase.from("contracts").update({ status: "processing", error: null }).eq("id", row.id);

    try {
      // 1. Get text — extract from file if needed.
      let text = row.extracted_text ?? "";
      if (!text && row.file_path) {
        text = await extractTextFromStored(supabase, row.file_path, row.file_type ?? "");
        await supabase.from("contracts").update({ extracted_text: text }).eq("id", row.id);
      }
      if (!text || text.trim().length < 30) {
        throw new Error("Could not extract usable text from this document.");
      }

      // 2. Truncate to a sane size for the model.
      const trimmed = text.length > 60_000 ? text.slice(0, 60_000) + "\n...[truncated]" : text;

      const { chatCompletion } = await import("./ai-gateway.server");
      const raw = await chatCompletion({
        model: "google/gemini-2.5-flash",
        jsonObject: true,
        temperature: 0.2,
        messages: [
          { role: "system", content: ANALYSIS_SYSTEM },
          { role: "user", content: `CONTRACT TEXT:\n\n${trimmed}` },
        ],
      });

      const analysis = safeParseJson(raw);
      await supabase
        .from("contracts")
        .update({ analysis, status: "ready" })
        .eq("id", row.id);
      void userId;
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("contracts").update({ status: "error", error: msg }).eq("id", row.id);
      throw new Error(msg);
    }
  });

export const askContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), question: z.string().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("contracts")
      .select("id,extracted_text,analysis,title")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Not found");
    if (!row.extracted_text) throw new Error("Contract has no extracted text yet.");

    const { data: history } = await supabase
      .from("chat_messages")
      .select("role,content")
      .eq("contract_id", data.id)
      .order("created_at", { ascending: true })
      .limit(40);

    await supabase
      .from("chat_messages")
      .insert({ contract_id: data.id, user_id: userId, role: "user", content: data.question });

    const trimmed =
      row.extracted_text.length > 50_000
        ? row.extracted_text.slice(0, 50_000) + "\n...[truncated]"
        : row.extracted_text;

    const { chatCompletion } = await import("./ai-gateway.server");
    const answer = await chatCompletion({
      model: "google/gemini-2.5-flash",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You are an assistant answering questions about a specific support contract titled "${row.title}".
Use ONLY the contract text and analysis provided. Quote exact clauses when relevant. If something is not in the contract, say so plainly. Keep answers concise and use markdown.`,
        },
        {
          role: "user",
          content: `CONTRACT TEXT:\n${trimmed}\n\nANALYSIS JSON:\n${JSON.stringify(row.analysis ?? {}, null, 2)}`,
        },
        ...(history ?? []).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: data.question },
      ],
    });

    await supabase
      .from("chat_messages")
      .insert({ contract_id: data.id, user_id: userId, role: "assistant", content: answer });

    return { answer };
  });

export const listChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_messages")
      .select("id,role,content,created_at")
      .eq("contract_id", data.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// --- helpers ---

function safeParseJson(s: string): unknown {
  const cleaned = s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Model did not return valid JSON");
  }
}

async function extractTextFromStored(
  supabase: { storage: { from: (b: string) => { download: (p: string) => Promise<{ data: Blob | null; error: unknown }> } } },
  path: string,
  fileType: string,
): Promise<string> {
  const { data: blob, error } = await supabase.storage.from("contracts").download(path);
  if (error || !blob) throw new Error("Could not download stored file");
  const buf = await blob.arrayBuffer();
  const lower = (fileType || "").toLowerCase();

  if (lower.includes("text") || path.endsWith(".txt")) {
    return new TextDecoder().decode(buf);
  }
  if (lower.includes("wordprocessingml") || path.endsWith(".docx")) {
    const { extractDocxText } = await import("./docx.server");
    return await extractDocxText(buf);
  }

  // PDF / image: use Gemini to OCR / extract text.
  const base64 = arrayBufferToBase64(buf);
  const mediaType = lower || (path.endsWith(".pdf") ? "application/pdf" : "image/png");
  const { chatCompletion } = await import("./ai-gateway.server");

  const isImage = mediaType.startsWith("image/");
  const userBlock = isImage
    ? [
        { type: "text" as const, text: "Extract ALL readable text from this document image verbatim. Preserve order and line breaks. Output only the text." },
        { type: "image_url" as const, image_url: { url: `data:${mediaType};base64,${base64}` } },
      ]
    : [
        { type: "text" as const, text: "Extract ALL text from this PDF verbatim. Preserve clause order and headings. Output only the contract text." },
        { type: "file" as const, file: { filename: path.split("/").pop() ?? "contract.pdf", file_data: `data:${mediaType};base64,${base64}` } },
      ];

  return await chatCompletion({
    model: "google/gemini-2.5-flash",
    temperature: 0,
    messages: [{ role: "user", content: userBlock }],
  });
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  // btoa is available in workers.
  return btoa(binary);
}
