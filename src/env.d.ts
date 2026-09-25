interface ImportMetaEnv {
  readonly PUBLIC_ADMIN_API_URL?: string;
  readonly PUBLIC_GITHUB_REPO?: string;
  readonly PUBLIC_GITHUB_BRANCH?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
