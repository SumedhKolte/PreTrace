import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";

/**
 * SSRF policy.
 *
 * - `strict` (production default): only public unicast addresses on standard ports.
 * - `allowPrivate` (explicit evaluation / local-dev mode): additionally allows loopback
 *   and RFC1918/ULA ranges so the batch evaluator can crawl localhost fixture sites.
 *
 * Link-local (incl. cloud metadata 169.254.169.254), unspecified, multicast, broadcast
 * and reserved ranges are blocked in EVERY mode — this is never globally disabled.
 */
export interface NetworkPolicy {
  allowPrivate: boolean;
}

export const STRICT_POLICY: NetworkPolicy = { allowPrivate: false };
export const EVALUATION_POLICY: NetworkPolicy = { allowPrivate: true };

const ALWAYS_ALLOWED_RANGES = new Set(["unicast"]);
const PRIVATE_RANGES = new Set(["private", "loopback", "uniqueLocal", "carrierGradeNat"]);
const STRICT_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home.arpa"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata"]);

export class BlockedUrlError extends Error {
  constructor(
    message: string,
    readonly reason: "protocol" | "credentials" | "port" | "hostname" | "address" | "syntax",
  ) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

export function ipRange(ip: string): string {
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return addr.range();
}

export function isIpAllowed(ip: string, policy: NetworkPolicy): boolean {
  if (!ipaddr.isValid(ip)) return false;
  const range = ipRange(ip);
  if (ALWAYS_ALLOWED_RANGES.has(range)) return true;
  return policy.allowPrivate && PRIVATE_RANGES.has(range);
}

/** Syntactic checks that don't need the network. Throws BlockedUrlError. */
export function assertUrlSyntaxAllowed(raw: string, policy: NetworkPolicy): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError("Invalid URL", "syntax");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("Only http(s) URLs are allowed", "protocol");
  if (u.username || u.password) throw new BlockedUrlError("URLs with embedded credentials are not allowed", "credentials");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!policy.allowPrivate) {
    if (!STRICT_PORTS.has(u.port)) throw new BlockedUrlError("Non-standard ports are not allowed", "port");
    if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new BlockedUrlError("Internal hostnames are not allowed", "hostname");
    }
  }
  if (net.isIP(host) && !isIpAllowed(host, policy)) {
    throw new BlockedUrlError("That address is not publicly routable", "address");
  }
  return u;
}

/** Full pre-flight check: syntax + every resolved address. */
export async function assertUrlAllowed(raw: string, policy: NetworkPolicy): Promise<URL> {
  const u = assertUrlSyntaxAllowed(raw, policy);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return u;
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    // DNS failure is an availability problem, not a policy violation; the fetcher reports it.
    return u;
  }
  for (const a of addrs) {
    if (!isIpAllowed(a.address, policy)) throw new BlockedUrlError("That host resolves to a non-public address", "address");
  }
  return u;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * DNS lookup hook for the HTTP agent. Validates the address actually being
 * connected to, which defeats DNS-rebinding (check-then-resolve-again) attacks.
 */
export function makeGuardedLookup(policy: NetworkPolicy) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, { ...options, verbatim: true }, (err, address, family) => {
      if (err) return callback(err, address as string, family);
      const list = Array.isArray(address) ? address : [{ address: address as string, family: family as number }];
      const bad = list.find((a) => !isIpAllowed(a.address, policy));
      if (bad) {
        const e = new BlockedUrlError(`Blocked connection to non-public address`, "address") as unknown as NodeJS.ErrnoException;
        e.code = "EBLOCKED";
        return callback(e, address as string, family);
      }
      callback(null, address as string | dns.LookupAddress[], family);
    });
  };
}
