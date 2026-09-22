export function readNeo4jConfiguration(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const uri = environment.NEO4J_URI ?? "bolt://127.0.0.1:7687";
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error("NEO4J_URI must be an absolute Bolt or Neo4j URL"); }
  if (!["bolt:", "bolt+s:", "bolt+ssc:", "neo4j:", "neo4j+s:", "neo4j+ssc:"].includes(parsed.protocol)
    || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error("NEO4J_URI must use Bolt or Neo4j without embedded credentials");
  }
  const username = environment.NEO4J_USERNAME ?? "neo4j";
  const password = environment.NEO4J_PASSWORD ?? "agent_memory_secret";
  const database = environment.NEO4J_DATABASE ?? "neo4j";
  for (const [name, value] of [["NEO4J_USERNAME", username], ["NEO4J_PASSWORD", password], ["NEO4J_DATABASE", database]]) {
    if (!value?.trim()) throw new Error(`${name} must not be empty`);
  }
  return { uri, username, password, database };
}
