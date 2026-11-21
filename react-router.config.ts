import type { Config } from "@react-router/dev/config";

// bb ui is served by the local CLI as static files: SPA mode, no server runtime.
export default {
  ssr: false,
} satisfies Config;
