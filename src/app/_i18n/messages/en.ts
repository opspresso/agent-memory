export const en = {
  "locale.label": "Language",
  "locale.change": "Change language",
  "theme.toggle": "Toggle theme",
  "meta.description":
    "A context platform connecting memory, RAG, and knowledge graphs for AI agents",
  "nav.guide": "Guide",
  "home.badge": "Shared Context",
  "home.eyebrow": "Shared context infrastructure for AI agents",
  "home.title": "Agents remember,",
  "home.titleSecond": "and create better answers.",
  "home.lede":
    "Connect long-term memory, RAG, and knowledge graphs into one context for AI agents. Use it directly through an MCP endpoint or together with Agent Studio.",
  "home.capability.memory": "Long-term Memory",
  "home.capability.memoryBody":
    "Preserve rules, decisions, and experience with revisions and validity periods.",
  "home.capability.rag": "Hybrid RAG",
  "home.capability.ragBody":
    "Ingest documents and combine full-text search with vector ranking.",
  "home.capability.graph": "Knowledge Graph",
  "home.capability.graphBody":
    "Explore entity relationships and trace them back to source memories and chunks.",
  "home.capability.sharing": "Flexible Sharing",
  "home.capability.sharingBody":
    "Share the context people need across organizations, teams, and individuals.",
  "login.eyebrow": "MEMORY WORKSPACE",
  "login.title": "Get started with Agent Memory",
  "login.lede": "Find the memory and context you need in one place.",
  "login.enterprise": "Sign in with Enterprise SSO",
  "login.google": "Sign in with Google",
  "login.or": "or",
  "login.signIn": "Sign in",
  "login.signUp": "Sign up",
  "login.name": "Name",
  "login.email": "Email",
  "login.password": "Password",
  "login.createAccount": "Create account",
  "login.emailSignIn": "Sign in with email",
  "login.requestFailed": "The sign-in request failed.",
  "login.providerUrlMissing": "The identity provider URL was not returned.",
  "login.failed": "Sign-in failed.",
  "login.notConfigured":
    "No identity provider is configured. Configure OIDC or Google environment variables."
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
