import neo4j from "neo4j-driver";
import { KnowledgeGraphUnavailableError } from "@/domain/knowledge/knowledge-topology";
import { createNeo4jKnowledgeTopologyStore } from "@/infrastructure/neo4j/knowledge-topology-store";
import { readNeo4jConfiguration } from "./neo4j-configuration";

const configuration = readNeo4jConfiguration();
export const neo4jDriver = neo4j.driver(configuration.uri, neo4j.auth.basic(configuration.username, configuration.password), {
  connectionTimeout: 5_000, connectionAcquisitionTimeout: 5_000, maxTransactionRetryTime: 5_000, maxConnectionPoolSize: 10
});
export const knowledgeTopologyStore = createNeo4jKnowledgeTopologyStore(neo4jDriver, configuration.database);

export async function checkKnowledgeGraphReadiness(): Promise<void> {
  try {
    await neo4jDriver.executeQuery("RETURN 1 AS ready", {}, { database: configuration.database, routing: "READ" });
  } catch (cause) {
    throw new KnowledgeGraphUnavailableError({ cause });
  }
}

export async function initializeKnowledgeGraph(): Promise<void> {
  await checkKnowledgeGraphReadiness();
  await knowledgeTopologyStore.initialize();
}
