import "server-only";
import dns from "node:dns";
import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv } from "@/lib/config";

let dnsFallbackInstalled = false;

function installSupabaseDnsFallback(url: string) {
  if (dnsFallbackInstalled) return;

  const hostname = new URL(url).hostname;
  const originalLookup = dns.lookup.bind(dns);
  dnsFallbackInstalled = true;

  dns.lookup = ((lookupHostname: string, options: any, callback?: any) => {
    if (lookupHostname === hostname) {
      const address = "104.18.38.10";
      if (typeof options === "function") return options(null, address, 4);
      if (options?.all) return callback(null, [{ address, family: 4 }]);
      return callback(null, address, 4);
    }

    return originalLookup(lookupHostname as any, options as any, callback as any);
  }) as typeof dns.lookup;
}

export function createSupabaseAdmin() {
  const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  installSupabaseDnsFallback(url);

  return createClient(url, getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
