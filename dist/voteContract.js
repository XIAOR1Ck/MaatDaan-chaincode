"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoteContract = void 0;
// chaincode/voting/src/voteContract.ts
const fabric_contract_api_1 = require("fabric-contract-api");
require("reflect-metadata");
// Composite key namespaces (object types)
const ELECTION_TYPE = 'ELECTION';
const CANDIDATE_TYPE = 'CANDIDATE';
const VOTE_TYPE = 'VOTE';
let VoteContract = class VoteContract extends fabric_contract_api_1.Contract {
    // ---------------------------------------------------------------------
    // Key helpers
    // Using composite keys instead of manual string concatenation avoids
    // ambiguity/collisions when an electionId or candidateId itself contains
    // an underscore (e.g. electionId "a_b" + candidateId "c" would previously
    // collide with electionId "a" + candidateId "b_c").
    // ---------------------------------------------------------------------
    electionKey(ctx, electionId) {
        return ctx.stub.createCompositeKey(ELECTION_TYPE, [electionId]);
    }
    candidateKey(ctx, electionId, candidateId) {
        return ctx.stub.createCompositeKey(CANDIDATE_TYPE, [electionId, candidateId]);
    }
    voteKey(ctx, electionId, proof) {
        return ctx.stub.createCompositeKey(VOTE_TYPE, [electionId, proof]);
    }
    async electionExists(ctx, electionId) {
        const bytes = await ctx.stub.getState(this.electionKey(ctx, electionId));
        return !!bytes && bytes.length > 0;
    }
    async getCandidate(ctx, electionId, candidateId) {
        const bytes = await ctx.stub.getState(this.candidateKey(ctx, electionId, candidateId));
        if (!bytes || bytes.length === 0) {
            return undefined;
        }
        return JSON.parse(bytes.toString());
    }
    // Create an election
    async CreateElection(ctx, electionId, name, description, startDate, endDate) {
        // Check if election with that ID already exist
        if ((await this.electionExists(ctx, electionId))) {
            throw new Error(`Election ${electionId} already exists.`);
        }
        const election = {
            electionId,
            name,
            description,
            startDate,
            endDate,
        };
        const key = this.electionKey(ctx, electionId);
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(election)));
    }
    // Initialize candidates for an election
    async AddCandidate(ctx, electionId, candidateId, name, affiliation) {
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
        const candidate = {
            electionId,
            candidateId,
            name,
            affiliation,
            voteCount: 0,
        };
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(candidate)));
    }
    async CastVote(ctx, electionId, candidateId, proof) {
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
        const voteRecord = {
            electionId,
            candidateId,
            timestamp: new Date().toISOString(),
        };
        // Commit to the chain
        const candidateKey = this.candidateKey(ctx, electionId, candidateId);
        await ctx.stub.putState(candidateKey, Buffer.from(JSON.stringify(candidate)));
        await ctx.stub.putState(voteKey, Buffer.from(JSON.stringify(voteRecord)));
    }
    async GetCandidates(ctx, electionId) {
        const iterator = await ctx.stub.getStateByPartialCompositeKey(CANDIDATE_TYPE, [electionId]);
        const results = [];
        let result = await iterator.next();
        while (!result.done) {
            results.push(JSON.parse(result.value.value.toString()));
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(results);
    }
    async GetResults(ctx, electionId) {
        if (!(await this.electionExists(ctx, electionId))) {
            throw new Error(`Election ${electionId} does not exist.`);
        }
        // NOTE: getStateByPartialCompositeKey takes the object type and the
        // partial attribute list, not an already-built composite key.
        const iterator = await ctx.stub.getStateByPartialCompositeKey(CANDIDATE_TYPE, [electionId]);
        const candidates = [];
        let result = await iterator.next();
        while (!result.done) {
            candidates.push(JSON.parse(result.value.value.toString()));
            result = await iterator.next();
        }
        await iterator.close();
        const totalVotes = candidates.reduce((sum, c) => sum + c.voteCount, 0);
        // Rank descending by voteCount (ties share the same rank)
        const sorted = [...candidates].sort((a, b) => b.voteCount - a.voteCount);
        const results = sorted.map((candidate, index) => {
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
        const summary = {
            electionId,
            totalVotes,
            results,
        };
        return JSON.stringify(summary);
    }
};
exports.VoteContract = VoteContract;
__decorate([
    (0, fabric_contract_api_1.Transaction)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "CreateElection", null);
__decorate([
    (0, fabric_contract_api_1.Transaction)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String, String, String, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "AddCandidate", null);
__decorate([
    (0, fabric_contract_api_1.Transaction)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String, String, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "CastVote", null);
__decorate([
    (0, fabric_contract_api_1.Transaction)(false),
    (0, fabric_contract_api_1.Returns)('string'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "GetCandidates", null);
__decorate([
    (0, fabric_contract_api_1.Transaction)(false),
    (0, fabric_contract_api_1.Returns)('string'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "GetResults", null);
exports.VoteContract = VoteContract = __decorate([
    (0, fabric_contract_api_1.Info)({ title: 'VoteContract', description: 'Simple voting chaincode' })
], VoteContract);
