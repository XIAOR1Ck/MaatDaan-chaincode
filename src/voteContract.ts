// chaincode/voting/src/voteContract.ts
import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import 'reflect-metadata';

// Composite key namespaces (object types)
const ELECTION_TYPE = 'ELECTION';
const CANDIDATE_TYPE = 'CANDIDATE';
const VOTE_TYPE = 'VOTE';

// Election Interface
interface Election {
  electionId: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
}

// Candidate Interface
interface Candidate {
  electionId: string;
  candidateId: string;
  name: string;
  affiliation: string;
  voteCount: number;
}

interface VoteRecord {
  electionId: string;
  candidateId: string;
  timestamp: string;
}

// returned by GetResults.
interface VotingResult {
  electionId: string;
  candidateId: string;
  name: string;
  affiliation: string;
  voteCount: number;
  votePercentage: number; // 0-100, rounded to 2 decimals
  rank: number;           // 1 = most votes
}

interface VotingResultSummary {
  electionId: string;
  totalVotes: number;
  results: VotingResult[];
}

@Info({ title: 'VoteContract', description: 'Simple voting chaincode' })
export class VoteContract extends Contract {

  // ---------------------------------------------------------------------
  // Key helpers
  // Using composite keys instead of manual string concatenation avoids
  // ambiguity/collisions when an electionId or candidateId itself contains
  // an underscore (e.g. electionId "a_b" + candidateId "c" would previously
  // collide with electionId "a" + candidateId "b_c").
  // ---------------------------------------------------------------------

  private electionKey(ctx: Context, electionId: string): string {
    return ctx.stub.createCompositeKey(ELECTION_TYPE, [electionId]);
  }

  private candidateKey(ctx: Context, electionId: string, candidateId: string): string {
    return ctx.stub.createCompositeKey(CANDIDATE_TYPE, [electionId, candidateId]);
  }

  private voteKey(ctx: Context, electionId: string, proof: string): string {
    return ctx.stub.createCompositeKey(VOTE_TYPE, [electionId, proof]);
  }

  private async electionExists(ctx: Context, electionId: string): Promise<boolean> {
    const bytes = await ctx.stub.getState(this.electionKey(ctx, electionId));
    return !!bytes && bytes.length > 0;
  }

  private async getCandidate(ctx: Context, electionId: string, candidateId: string): Promise<Candidate | undefined> {
    const bytes = await ctx.stub.getState(this.candidateKey(ctx, electionId, candidateId));
    if (!bytes || bytes.length === 0) {
      return undefined;
    }
    return JSON.parse(bytes.toString()) as Candidate;
  }

// Create an election
  @Transaction()
  public async CreateElection(
    ctx: Context,
  electionId: string,
  name: string,
  description: string,
  startDate: string,
  endDate: string,
    
): Promise<void> {
  // Check if election with that ID already exist
  if ((await this.electionExists(ctx, electionId))) {
      throw new Error(`Election ${electionId} already exists.`);
    }
    
  const election: Election = {
    electionId,
name,
description,
startDate,
endDate,
};

  const key = this.electionKey(ctx, electionId);
await ctx.stub.putState(key, Buffer.from(JSON.stringify(election)));


  
}
  @Transaction(false)
    @Returns('string')
    public async GetAllElections(ctx: Context): Promise<string> {
      // Empty attribute array = iterate over every key under ELECTION_TYPE
      const iterator = await ctx.stub.getStateByPartialCompositeKey(ELECTION_TYPE, []);
      const elections: Election[] = [];
      let result = await iterator.next();
      while (!result.done) {
        elections.push(JSON.parse(result.value.value.toString()));
        result = await iterator.next();
      }
      await iterator.close();
      return JSON.stringify(elections);
    }

  // Initialize candidates for an election
  @Transaction()
  public async AddCandidate(
    ctx: Context,
    electionId: string,
    candidateId: string,
    name: string,
    affiliation: string,
  ): Promise<void> {
    // Check if the election exists
    if (!(await this.electionExists(ctx, electionId))) {
      throw new Error(`Election ${electionId} does not exist.`);
    }

    const key = this.candidateKey(ctx, electionId, candidateId);

    // Check if the candidate already exists
    const existing = await this.getCandidate(ctx, electionId, candidateId);
    if (existing) {
      throw new Error(`Candidate ${candidateId} already exists in election ${electionId}.`);
    }

    const candidate: Candidate = {
      electionId,
      candidateId,
      name,
      affiliation,
      voteCount: 0,
    };

    await ctx.stub.putState(key, Buffer.from(JSON.stringify(candidate)));
  }

  @Transaction()
  public async CastVote(
    ctx: Context,
    electionId: string,
    candidateId: string,
    proof: string,
  ): Promise<void> {
    // Check if the election exists
    if (!(await this.electionExists(ctx, electionId))) {
      throw new Error(`Election ${electionId} does not exist.`);
    }

    // Check if candidate exists
    // FIX: the original code threw "already exists" when the candidate WAS
    // found, which meant voting for a real candidate always failed (and
    // voting for a nonexistent one silently threw a JSON.parse error on
    // undefined candidateBytes instead of a clear message). The check must
    // fail when the candidate is NOT found.
    const candidate = await this.getCandidate(ctx, electionId, candidateId);
    if (!candidate) {
      throw new Error(`Candidate ${candidateId} does not exist in election ${electionId}.`);
    }

    // Check if already voted (proof token reused)
    const voteKey = this.voteKey(ctx, electionId, proof);
    const voteBytes = await ctx.stub.getState(voteKey);
    if (voteBytes && voteBytes.length > 0) {
      throw new Error(`Proof token ${proof} has already been used`);
    }

    // Add vote to count
    candidate.voteCount += 1;

    const voteRecord: VoteRecord = {
      electionId,
      candidateId,
      timestamp: new Date().toISOString(),
    };

    // Commit to the chain
    const candidateKey = this.candidateKey(ctx, electionId, candidateId);
    await ctx.stub.putState(candidateKey, Buffer.from(JSON.stringify(candidate)));
    await ctx.stub.putState(voteKey, Buffer.from(JSON.stringify(voteRecord)));
  }

  @Transaction(false)
  @Returns('string')
  public async GetCandidates(ctx: Context, electionId: string): Promise<string> {
    const iterator = await ctx.stub.getStateByPartialCompositeKey(CANDIDATE_TYPE, [electionId]);
    const results: Candidate[] = [];
    let result = await iterator.next();
    while (!result.done) {
      results.push(JSON.parse(result.value.value.toString()));
      result = await iterator.next();
    }
    await iterator.close();
    return JSON.stringify(results);
  }

 
  @Transaction(false)
  @Returns('string')
  public async GetResults(ctx: Context, electionId: string): Promise<string> {
    if (!(await this.electionExists(ctx, electionId))) {
      throw new Error(`Election ${electionId} does not exist.`);
    }
 
    // NOTE: getStateByPartialCompositeKey takes the object type and the
    // partial attribute list, not an already-built composite key.
    const iterator = await ctx.stub.getStateByPartialCompositeKey(CANDIDATE_TYPE, [electionId]);
    const candidates: Candidate[] = [];
    let result = await iterator.next();
    while (!result.done) {
      candidates.push(JSON.parse(result.value.value.toString()));
      result = await iterator.next();
    }
    await iterator.close();
 
    const totalVotes = candidates.reduce((sum, c) => sum + c.voteCount, 0);
 
    // Rank descending by voteCount (ties share the same rank)
    const sorted = [...candidates].sort((a, b) => b.voteCount - a.voteCount);
 
    const results: VotingResult[] = sorted.map((candidate, index) => {
      const rank = index > 0 && sorted[index - 1].voteCount === candidate.voteCount
        ? sorted.findIndex((c) => c.voteCount === candidate.voteCount) + 1
        : index + 1;
 
      return {
        electionId: candidate.electionId,
        candidateId: candidate.candidateId,
        name: candidate.name,
        affiliation: candidate.affiliation,
        voteCount: candidate.voteCount,
        votePercentage: totalVotes > 0
          ? Math.round((candidate.voteCount / totalVotes) * 10000) / 100
          : 0,
        rank,
      };
    });
 
    const summary: VotingResultSummary = {
      electionId,
      totalVotes,
      results,
    };
 
    return JSON.stringify(summary);
  }
}
