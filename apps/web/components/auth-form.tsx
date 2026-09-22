"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { mutate } from "swr";
import { LoginSchema, RegisterSchema } from "@preptrace/shared";
import { Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const schema = mode === "login" ? LoginSchema : RegisterSchema;
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api(`/auth/${mode}`, { body: parsed.data });
      await mutate("/auth/me");
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const isLogin = mode === "login";
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Link href="/" className="w-fit">
          <Wordmark />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-[26px] font-semibold tracking-[-0.025em]">{isLogin ? "Welcome back" : "Create your account"}</h1>
          <p className="mt-1.5 text-[14.5px] text-muted">{isLogin ? "Sign in to continue preparing." : "Start turning job descriptions into interview plans."}</p>
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            {!isLogin && (
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" autoComplete="name" value={values.name} onChange={set("name")} aria-invalid={!!errors.name} aria-describedby="name-err" />
                <FieldError id="name-err">{errors.name}</FieldError>
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={values.email} onChange={set("email")} aria-invalid={!!errors.email} aria-describedby="email-err" />
              <FieldError id="email-err">{errors.email}</FieldError>
            </div>
            <div>
              <Label htmlFor="password" hint={!isLogin ? "At least 8 characters" : undefined}>
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={values.password}
                onChange={set("password")}
                aria-invalid={!!errors.password}
                aria-describedby="password-err"
              />
              <FieldError id="password-err">{errors.password}</FieldError>
            </div>
            {formError && (
              <div role="alert" className="rounded-lg border border-[#f4d1cc] bg-bad-soft px-3 py-2 text-[13px] text-bad">
                {formError}
              </div>
            )}
            <Button type="submit" variant="dark" size="lg" className="w-full" loading={busy}>
              {isLogin ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-6 text-center text-[13.5px] text-muted">
            {isLogin ? "New here? " : "Already have an account? "}
            <Link href={isLogin ? "/register" : "/login"} className="font-medium text-accent-700 hover:underline">
              {isLogin ? "Create an account" : "Sign in"}
            </Link>
          </p>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-night lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(108,99,245,0.35),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(108,99,245,0.15),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-center px-14">
          <div className="max-w-md space-y-3">
            {[
              ["✓", "Extracting requirements", "Identified 6 must-have and 3 nice-to-have requirements"],
              ["✓", "Researching hiring process", "Found a hiring process page — 5 stages"],
              ["✓", "Checking coverage", "Coverage check 1 found 1 gap (r3)"],
              ["●", "Filling gaps", "Generating targeted questions for PostgreSQL…"],
            ].map(([mark, title, detail], i) => (
              <div key={title} className="animate-rise rounded-xl border border-night-line bg-night-2/80 p-4 backdrop-blur" style={{ animationDelay: `${i * 120}ms` }}>
                <div className="flex items-center gap-2.5 text-[13.5px] font-medium text-white">
                  <span className={mark === "●" ? "h-2 w-2 animate-pulse-dot rounded-full bg-accent-400" : "text-good"}>{mark === "●" ? "" : mark}</span>
                  {title}
                </div>
                <div className="mt-1 pl-5 text-[12.5px] text-white/55">{detail}</div>
              </div>
            ))}
            <p className="pt-6 text-[13px] leading-relaxed text-white/50">Every question traces back to a requirement in your JD and the research that informed it.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
