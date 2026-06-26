import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { FileScan, Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Contract Review Agent" },
      { name: "description", content: "Sign in to review support contracts with AI." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function signIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/dashboard" });
  }

  async function signUp() {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Account created. You're signed in.");
    navigate({ to: "/dashboard" });
  }

  async function google() {
    const res = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (res.error) return toast.error(String(res.error));
    if (res.redirected) return;
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-secondary/40 to-background">
      <header className="px-6 py-5 flex items-center gap-2">
        <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shadow-soft">
          <FileScan className="size-5" />
        </div>
        <Link to="/auth" className="font-semibold tracking-tight">Clausely</Link>
      </header>
      <div className="flex-1 grid place-items-center px-4 pb-12">
        <Card className="w-full max-w-md shadow-soft border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl">Welcome</CardTitle>
            <CardDescription>
              Sign in to review support contracts, SLAs and service agreements in seconds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button variant="outline" className="w-full" onClick={google}>
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex-1 h-px bg-border" /> or <div className="flex-1 h-px bg-border" />
            </div>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>
              <TabsContent value="signin" className="space-y-3 mt-4">
                <Field id="e1" label="Email" value={email} onChange={setEmail} type="email" />
                <Field id="p1" label="Password" value={password} onChange={setPassword} type="password" />
                <Button className="w-full" onClick={signIn} disabled={loading || !email || !password}>
                  {loading && <Loader2 className="size-4 mr-2 animate-spin" />} Sign in
                </Button>
              </TabsContent>
              <TabsContent value="signup" className="space-y-3 mt-4">
                <Field id="e2" label="Email" value={email} onChange={setEmail} type="email" />
                <Field id="p2" label="Password" value={password} onChange={setPassword} type="password" />
                <Button className="w-full" onClick={signUp} disabled={loading || !email || password.length < 6}>
                  {loading && <Loader2 className="size-4 mr-2 animate-spin" />} Create account
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
