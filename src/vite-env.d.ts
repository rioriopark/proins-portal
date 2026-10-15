/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_DEMO_MODE?: string
  readonly VITE_DEMO_GUEST_ID?: string
  readonly VITE_DEMO_GUEST_PASSWORD?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
