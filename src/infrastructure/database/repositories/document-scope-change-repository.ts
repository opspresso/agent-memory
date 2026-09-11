import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { DocumentScopeChangeRepository } from "@/domain/document/document-scope-change";
import { canAccessScopedResource } from "@/domain/identity/organization-access";
import { sameScope, scopeCovers } from "@/domain/identity/scope-coverage";
import { planKnowledgeScopeChange } from "@/domain/knowledge/knowledge-scope-change";
import { knowledgeCanonicalNameKey } from "@/domain/knowledge/knowledge-identity";
import type { KnowledgeSource } from "@/domain/knowledge/knowledge-graph";
import type { AgentMemoryDatabase } from "../client";
import { documentChunks, documents, documentScopeChanges, knowledgeNodes, knowledgeEdges, knowledgeNodeSources, knowledgeEdgeSources, teams } from "../schema";
import { createOrganizationAccessRepository } from "./organization-access-repository";
import { documentFromRow } from "./document-repository";
import { knowledgeScopeFromRow, knowledgeSourceFromRow } from "./knowledge-node-persistence";
import { loadKnowledgeSourceScopes, lockKnowledgeScope, sourceKey } from "./knowledge-scope-lock";

export function createDocumentScopeChangeRepository(db: AgentMemoryDatabase): DocumentScopeChangeRepository {
  return {
    async changeScope(input) {
      return db.transaction(async (transaction) => {
        const organizationId = input.access.organizationId;
        // Membership/team administration already uses this installation lock.
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`);
        await lockKnowledgeScope(transaction, organizationId, true);
        const currentAccess = await createOrganizationAccessRepository(transaction).findByUser(organizationId, input.access.userId);
        if (!currentAccess) return { status: "access_denied" };
        const access = { ...currentAccess, ...(input.access.principalKind ? { principalKind: input.access.principalKind } : {}) };
        const [row] = await transaction.select().from(documents).where(and(eq(documents.organizationId, organizationId), eq(documents.id, input.documentId))).for("update");
        if (!row || row.status === "archived" || !canAccessScopedResource(access, "read", knowledgeScopeFromRow(row))) return { status: "not_found" };
        if (!canAccessScopedResource(access, "manage", knowledgeScopeFromRow(row)) || !canAccessScopedResource(access, "manage", input.scope)) return { status: "access_denied" };
        if (row.updatedAt.toISOString() !== input.expectedUpdatedAt) return { status: "conflict" };
        if (row.status !== "ready") return { status: "not_ready" };
        if (input.scope.kind === "team") {
          const [team] = await transaction.select({ id: teams.id }).from(teams).where(and(eq(teams.organizationId, organizationId), eq(teams.id, input.scope.teamId)));
          if (!team) return { status: "invalid_target" };
        }
        const now = new Date(Math.max(input.now.getTime(), row.updatedAt.getTime() + 1));
        const scopeValues = { scopeKind: input.scope.kind, teamId: input.scope.kind === "team" ? input.scope.teamId : null, userId: input.scope.kind === "user" ? input.scope.userId : null };
        const chunks = await transaction.select({ id: documentChunks.id }).from(documentChunks).where(and(eq(documentChunks.organizationId, organizationId), eq(documentChunks.documentId, row.id)));
        const chunkIds = chunks.map((chunk) => chunk.id);
        const linkedNodes = chunkIds.length ? await transaction.select({ id: knowledgeNodeSources.nodeId }).from(knowledgeNodeSources).where(and(eq(knowledgeNodeSources.organizationId, organizationId), inArray(knowledgeNodeSources.chunkId, chunkIds))) : [];
        const linkedEdges = chunkIds.length ? await transaction.select({ id: knowledgeEdgeSources.edgeId }).from(knowledgeEdgeSources).where(and(eq(knowledgeEdgeSources.organizationId, organizationId), inArray(knowledgeEdgeSources.chunkId, chunkIds))) : [];
        const nodeIds = [...new Set(linkedNodes.map((node) => node.id))];
        const edgeIds = [...new Set(linkedEdges.map((edge) => edge.id))];
        const affectedNodes = new Set(nodeIds), affectedEdges = new Set(edgeIds);
        const edges = nodeIds.length || edgeIds.length ? await transaction.select().from(knowledgeEdges).where(and(eq(knowledgeEdges.organizationId, organizationId), or(
          inArray(knowledgeEdges.id, edgeIds), inArray(knowledgeEdges.sourceNodeId, nodeIds), inArray(knowledgeEdges.targetNodeId, nodeIds)
        ))) : [];
        const allNodeIds = [...new Set([...nodeIds, ...edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId])])];
        const nodes = allNodeIds.length ? await transaction.select().from(knowledgeNodes).where(and(eq(knowledgeNodes.organizationId, organizationId), inArray(knowledgeNodes.id, allNodeIds))) : [];
        const nodeSources = allNodeIds.length ? await transaction.select().from(knowledgeNodeSources).where(and(eq(knowledgeNodeSources.organizationId, organizationId), inArray(knowledgeNodeSources.nodeId, allNodeIds))) : [];
        const edgeSources = edgeIds.length ? await transaction.select().from(knowledgeEdgeSources).where(and(eq(knowledgeEdgeSources.organizationId, organizationId), inArray(knowledgeEdgeSources.edgeId, edgeIds))) : [];
        const sources = await loadKnowledgeSourceScopes(transaction, organizationId, [...nodeSources, ...edgeSources].map(knowledgeSourceFromRow), input.now);
        // Evaluate the proposed source scope before persisting any changes.
        for (const chunkId of chunkIds) {
          const source = sources.get(`chunk:${chunkId}`);
          if (source) sources.set(`chunk:${chunkId}`, { ...source, scope: input.scope });
        }
        function sourceIssue(provenance: readonly KnowledgeSource[]) {
          if (!provenance.length || provenance.some((source) => !sources.get(sourceKey(source))?.available)) return "source_unavailable" as const;
          if (provenance.some((source) => !scopeCovers(sources.get(sourceKey(source))!.scope, input.scope))) return "source_scope" as const;
          return undefined;
        }
        const names = [...new Set(nodes.filter((node) => affectedNodes.has(node.id)).map((node) => knowledgeCanonicalNameKey(node.canonicalName)))];
        const possibleDuplicates = names.length ? await transaction.select({ id: knowledgeNodes.id, kind: knowledgeNodes.kind, canonicalName: knowledgeNodes.canonicalName, organizationId: knowledgeNodes.organizationId, scopeKind: knowledgeNodes.scopeKind, teamId: knowledgeNodes.teamId, userId: knowledgeNodes.userId }).from(knowledgeNodes)
          .where(and(eq(knowledgeNodes.organizationId, organizationId), eq(knowledgeNodes.scopeKind, input.scope.kind), inArray(knowledgeNodes.canonicalNameKey, names))) : [];
        function groupSources<T extends { memoryId: string | null; chunkId: string | null }>(rows: readonly T[], id: (row: T) => string) {
          const grouped = new Map<string, KnowledgeSource[]>();
          for (const row of rows) {
            const key = id(row), group = grouped.get(key) ?? [];
            group.push(knowledgeSourceFromRow(row));
            grouped.set(key, group);
          }
          return grouped;
        }
        const nodeProvenance = groupSources(nodeSources, (source) => source.nodeId);
        const edgeProvenance = groupSources(edgeSources, (source) => source.edgeId);
        const nodeIdentity = (node: { kind: string; canonicalName: string }) => JSON.stringify([node.kind, knowledgeCanonicalNameKey(node.canonicalName)]);
        const edgeIdentity = (edge: { sourceNodeId: string; targetNodeId: string; predicate: string }) => JSON.stringify([edge.sourceNodeId, edge.predicate, edge.targetNodeId]);
        function identities<T extends { id: string }>(rows: readonly T[], key: (row: T) => string) {
          const result = new Map<string, Set<string>>();
          for (const row of rows) {
            const identity = key(row), ids = result.get(identity) ?? new Set<string>();
            ids.add(row.id);
            result.set(identity, ids);
          }
          return result;
        }
        const eligibleNodes = nodes.filter((node) => affectedNodes.has(node.id) &&
          canAccessScopedResource(access, "manage", knowledgeScopeFromRow(node)) && !sourceIssue(nodeProvenance.get(node.id) ?? []));
        const eligibleEdges = edges.filter((edge) => affectedEdges.has(edge.id) &&
          canAccessScopedResource(access, "manage", knowledgeScopeFromRow(edge)) && !sourceIssue(edgeProvenance.get(edge.id) ?? []));
        const nodeIdentities = identities([...possibleDuplicates.filter((node) => sameScope(knowledgeScopeFromRow(node), input.scope)), ...eligibleNodes], nodeIdentity);
        const sourceNodeIds = [...new Set(edges.filter((edge) => affectedEdges.has(edge.id)).map((edge) => edge.sourceNodeId))];
        const possibleEdgeDuplicates = sourceNodeIds.length ? await transaction.select().from(knowledgeEdges).where(and(
          eq(knowledgeEdges.organizationId, organizationId), eq(knowledgeEdges.scopeKind, input.scope.kind), inArray(knowledgeEdges.sourceNodeId, sourceNodeIds)
        )) : [];
        const edgeIdentities = identities([...possibleEdgeDuplicates.filter((edge) => sameScope(knowledgeScopeFromRow(edge), input.scope)), ...eligibleEdges], edgeIdentity);
        const plan = planKnowledgeScopeChange({
          access, target: input.scope,
          nodes: nodes.map((node) => ({
            id: node.id, scope: knowledgeScopeFromRow(node), affected: affectedNodes.has(node.id),
            sourceIssue: sourceIssue(nodeProvenance.get(node.id) ?? []),
            visibleAtTarget: (nodeProvenance.get(node.id) ?? []).some((source) => {
              const record = sources.get(sourceKey(source));
              return record?.available && scopeCovers(record.scope, input.scope);
            }),
            identityConflict: (nodeIdentities.get(nodeIdentity(node))?.size ?? 0) > 1
          })),
          edges: edges.map((edge) => ({
            id: edge.id, scope: knowledgeScopeFromRow(edge), affected: affectedEdges.has(edge.id), sourceNodeId: edge.sourceNodeId, targetNodeId: edge.targetNodeId,
            sourceIssue: sourceIssue(edgeProvenance.get(edge.id) ?? []),
            identityConflict: (edgeIdentities.get(edgeIdentity(edge))?.size ?? 0) > 1
          }))
        });
        const changedNodes = new Set(plan.nodeIds), changedEdges = new Set(plan.edgeIds);
        const uncoveredNode = nodes.some((node) => affectedNodes.has(node.id) && !changedNodes.has(node.id) && !scopeCovers(input.scope, knowledgeScopeFromRow(node)));
        const uncoveredEdge = edges.some((edge) => affectedEdges.has(edge.id) && !changedEdges.has(edge.id) && !scopeCovers(input.scope, knowledgeScopeFromRow(edge)));
        // Shared properties and embeddings are not attributed per source. A
        // skipped, wider graph resource could retain information from this
        // document even after its provenance is filtered from public reads.
        if (uncoveredNode || uncoveredEdge) return { status: "related_scope_conflict" };
        const [updated] = await transaction.update(documents).set({ ...scopeValues, updatedAt: now }).where(eq(documents.id, row.id)).returning();
        if (!updated) throw new Error("document scope update returned no row");
        if (plan.nodeIds.length) await transaction.update(knowledgeNodes).set({ ...scopeValues, updatedAt: now }).where(and(eq(knowledgeNodes.organizationId, organizationId), inArray(knowledgeNodes.id, plan.nodeIds)));
        if (plan.edgeIds.length) await transaction.update(knowledgeEdges).set(scopeValues).where(and(eq(knowledgeEdges.organizationId, organizationId), inArray(knowledgeEdges.id, plan.edgeIds)));
        await transaction.insert(documentScopeChanges).values({ organizationId, documentId: row.id, previousScope: knowledgeScopeFromRow(row), scope: input.scope, knowledge: plan.summary, changedBy: access.userId, createdAt: now });
        return { status: "changed", document: documentFromRow(updated), knowledge: plan.summary };
      });
    }
  };
}
