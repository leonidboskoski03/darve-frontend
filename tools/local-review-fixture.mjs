import { pathToFileURL } from 'node:url';
import path from 'node:path';
/** Actual snapshot/processing repositories with explicitly synthetic evaluation model ports. */
export async function createLocalReviewFixture(backend, database) {
  const db = await import(
    pathToFileURL(path.join(backend, 'packages/database/dist/index.js')).href
  );
  const domain = await import(
    pathToFileURL(path.join(backend, 'packages/domain/dist/index.js')).href
  );
  const storage = {
    schemaVersion: 1,
    purpose: 'synthetic_evaluation',
    reviewProfileHash: null,
    embeddingSpace: {
      schemaVersion: 1,
      vendor: 'openai',
      model: 'fixture-embedding',
      version: 'isolated-v1',
      dimensions: 2,
      representation: 'float32',
      distance: 'cosine',
      preprocessingVersion: 'raw-extracted-text-v1',
    },
    limits: {
      memberPageSize: 2,
      inputPageSize: 2,
      leaseMs: 30000,
      maxAttempts: 2,
      deadlineMs: 600000,
    },
  };
  const profile = {
    version: 'analysis-processing-v1',
    storage,
    grouping: {
      version: domain.ANALYSIS_GROUPING_VERSION,
      inputOrder: 'author_rotation',
      modelConfigurationHash: 'a'.repeat(64),
      memberPageSize: 2,
      maxMembers: 100,
      maxModelCalls: 100,
      neighborLimit: 1,
      maxRankGroups: 20,
      shortlistSize: 3,
      timeoutMs: 1000,
    },
    reviewLimits: { batchMembers: 20, contextChanges: 4, rationaleUnits: 512 },
    limits: {
      globalSlots: 2,
      sharedSlots: 3,
      collectorReserveSlots: 1,
      ownerSlots: 1,
      turnCalls: 1,
      maxCalls: 100,
      maxAttempts: 4,
      leaseMs: 30000,
      deadlineMs: 600000,
      retryMs: 10,
      globalBudgetMicroUsd: '1000000',
      runBudgetMicroUsd: '100000',
      maxCallCostMicroUsd: '1000',
      maxQueuedJobs: 50,
      maxQueueAgeMs: 600000,
      admissionReserveMicroUsd: '10000',
      maxOutputTokens: 1000,
    },
  };
  const observed = (data) => ({
    attempted: true,
    model: 'fixture',
    elapsedMs: 1,
    usage: {
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 10,
      reasoningTokens: 0,
    },
    outcome: { kind: 'success', data },
  });
  const models = {
    configurationHash: 'a'.repeat(64),
    reviewRequestFits: () => true,
    embed: async (texts) => ({ ...observed(texts.map(() => [1, 0])), model: 'fixture-embedding' }),
    review: async (input) => {
      const groups = new Map();
      for (const member of input.members) {
        const group = groups.get(member.text) ?? [];
        group.push(member.memberId);
        groups.set(member.text, group);
      }
      return observed({
        contractVersion: input.contractVersion,
        batchId: input.batchId,
        groups: [...groups.values()].map((memberIds) => ({
          memberIds,
          representativeMemberId: memberIds[0],
          equivalenceRationale: 'Synthetic equivalent obligation.',
          safety: { classification: 'eligible', reason: 'none' },
        })),
      });
    },
    rank: async (input) =>
      observed({
        version: input.version,
        batchId: input.batchId,
        orderedGroupIds: input.groups.map((group) => group.groupId),
        ...(input.version === domain.ANALYSIS_CONTEXTUAL_RANK_VERSION
          ? {
              reasons: input.groups.map((group) => ({
                groupId: group.groupId,
                reason: 'Synthetic watchable activity.',
              })),
            }
          : {}),
      }),
  };
  return {
    async publish(userId, roundId) {
      await database.collectionRound.findFirstOrThrow({
        where: { id: roundId, userId, state: 'closed' },
      });
      const work = await database.collectionWorkIntent.findFirstOrThrow({
        where: { snapshot: { roundId } },
      });
      const reference = {
        schemaVersion: 1,
        intentId: work.id,
        snapshotId: work.snapshotId,
        snapshotVersion: work.snapshotVersion,
        inputHash: work.inputHash,
      };
      const sources = db.createAnalysisEmbeddingRepository(database);
      const runId = await sources.createRun(userId, reference, storage, 'synthetic-use-v1');
      for (let count = 0; count < 20; count++) {
        if ((await sources.prepareMembers(userId, runId)).ready) break;
      }
      const processing = db.createAnalysisProcessingRepository(database);
      await processing.admit(userId, runId, profile);
      const service = domain.createAnalysisProcessingService(
        processing,
        sources,
        models,
        { permit: async () => 'synthetic-use-v1' },
        profile,
      );
      for (let count = 0; count < 100; count++) {
        if ((await processing.status(userId, runId)).phase === 'completed') break;
        await service.turn();
      }
      if ((await processing.status(userId, runId)).phase !== 'completed')
        throw new Error('Controlled analysis did not publish');
      return db.createAnalysisProjectionRepository(database).page(userId, roundId, 50, null);
    },
    async counts(userId) {
      return {
        challenges: await database.acceptedChallenge.count({ where: { userId } }),
        receipts: await database.challengeAcceptanceReceipt.count({ where: { userId } }),
      };
    },
    async restrict(roundId) {
      const snapshot = await database.analysisSnapshot.findUniqueOrThrow({ where: { roundId } });
      await database.collectionSnapshotAccess.update({
        where: { snapshotId: snapshot.id },
        data: { restrictedAt: new Date(), reasonCode: 'SYNTHETIC_RESTRICTION' },
      });
    },
  };
}
