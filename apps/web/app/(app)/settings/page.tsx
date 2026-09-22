"use client";

import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { Cpu, KeyRound, LogOut, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Kbd } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import useSWR from "swr";
import { fetcher } from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();
  const me = useMe();
  const health = useSWR<{ status: string; db: string; llm: string }>("/health", fetcher);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    await mutate(() => true, undefined, { revalidate: false });
    router.replace("/login");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Your account and how PrepTrace works." />
      <Card>
        <CardHeader title="Account" icon={<User className="h-4 w-4" />} />
        <CardBody className="space-y-3 text-[14px]">
          <div className="flex justify-between gap-4">
            <span className="text-muted">Name</span>
            <span className="font-medium">{me.data?.user.name}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted">Email</span>
            <span className="font-medium">{me.data?.user.email}</span>
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={logout}>
              Sign out
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="System" icon={<Cpu className="h-4 w-4" />} description="Live status of the services behind your kits." />
        <CardBody className="space-y-3 text-[14px]">
          {[
            ["API", health.data?.status === "ok" ? "Operational" : health.error ? "Unavailable" : "Checking…"],
            ["Database", health.data?.db === "up" ? "Connected" : health.data ? "Disconnected" : "Checking…"],
            ["AI provider", health.data?.llm === "configured" ? "Configured" : health.data ? "Not configured — generation will fail" : "Checking…"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-muted">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Privacy & safety" icon={<ShieldCheck className="h-4 w-4" />} />
        <CardBody className="space-y-2 text-[13.5px] leading-relaxed text-ink-2">
          <p>Your kits, edits and practice history are private to your account. Company research is built only from public web pages and may be cached and reused across users.</p>
          <p>The crawler respects robots.txt, never follows links to private network addresses, and treats all page text as data — instructions embedded in websites are ignored.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Keyboard shortcuts" icon={<KeyRound className="h-4 w-4" />} />
        <CardBody className="grid gap-2 text-[13.5px] sm:grid-cols-2">
          {[
            [["⌘", "K"], "Command palette"],
            [["Space"], "Reveal answer (practice)"],
            [["1", "–", "5"], "Rate confidence"],
            [["Esc"], "Close dialogs"],
          ].map(([keys, label]) => (
            <div key={label as string} className="flex items-center justify-between rounded-lg bg-subtle px-3 py-2">
              <span className="text-ink-2">{label as string}</span>
              <span className="flex gap-1">{(keys as string[]).map((k) => (k === "–" ? <span key={k} className="text-faint">–</span> : <Kbd key={k}>{k}</Kbd>))}</span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
