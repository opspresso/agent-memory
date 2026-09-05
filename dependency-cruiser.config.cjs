/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-isolation",
      severity: "error",
      from: { path: "^src/domain" },
      to: { path: "^src/(application|infrastructure|app|lib)" }
    },
    {
      name: "domain-no-third-party-dependencies",
      severity: "error",
      from: { path: "^src/domain" },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"] }
    },
    {
      name: "application-dependency-direction",
      severity: "error",
      from: { path: "^src/application" },
      to: { path: "^src/(infrastructure|app|lib)(/|$)" }
    },
    {
      name: "application-no-third-party-dependencies",
      severity: "error",
      from: { path: "^src/application" },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"] }
    },
    {
      name: "infrastructure-dependency-direction",
      severity: "error",
      from: { path: "^src/infrastructure" },
      to: { path: "^src/(application|app|lib)" }
    },
    {
      name: "app-does-not-import-infrastructure",
      severity: "error",
      from: { path: "^src/app" },
      to: { path: "^src/infrastructure" }
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      conditionNames: ["import", "require", "node", "default"],
      exportsFields: ["exports"]
    }
  }
};
