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
let VoteContract = class VoteContract extends fabric_contract_api_1.Contract {
    async InitCandidates(ctx, candidatesJson) {
        const candidates = JSON.parse(candidatesJson);
        for (const c of candidates) {
            const candidate = { id: c.id, name: c.name, voteCount: 0 };
            await ctx.stub.putState(`CANDIDATE_${c.id}`, Buffer.from(JSON.stringify(candidate)));
        }
    }
    async RegisterVoter(ctx, voterId) {
        const existing = await ctx.stub.getState(`VOTER_${voterId}`);
        if (existing && existing.length > 0) {
            throw new Error(`Voter ${voterId} already registered`);
        }
        const voter = { id: voterId, hasVoted: false };
        await ctx.stub.putState(`VOTER_${voterId}`, Buffer.from(JSON.stringify(voter)));
    }
    async CastVote(ctx, voterId, candidateId) {
        const voterBytes = await ctx.stub.getState(`VOTER_${voterId}`);
        if (!voterBytes || voterBytes.length === 0) {
            throw new Error(`Voter ${voterId} is not registered`);
        }
        const voter = JSON.parse(voterBytes.toString());
        if (voter.hasVoted) {
            throw new Error(`Voter ${voterId} has already voted`);
        }
        const candidateBytes = await ctx.stub.getState(`CANDIDATE_${candidateId}`);
        if (!candidateBytes || candidateBytes.length === 0) {
            throw new Error(`Candidate ${candidateId} does not exist`);
        }
        const candidate = JSON.parse(candidateBytes.toString());
        candidate.voteCount += 1;
        voter.hasVoted = true;
        await ctx.stub.putState(`CANDIDATE_${candidateId}`, Buffer.from(JSON.stringify(candidate)));
        await ctx.stub.putState(`VOTER_${voterId}`, Buffer.from(JSON.stringify(voter)));
        // Emit event so the API layer / UI can react in real time
        ctx.stub.setEvent('VoteCast', Buffer.from(JSON.stringify({ voterId, candidateId })));
    }
    async GetResults(ctx) {
        const iterator = await ctx.stub.getStateByRange('CANDIDATE_', 'CANDIDATE_\uffff');
        const results = [];
        let result = await iterator.next();
        while (!result.done) {
            results.push(JSON.parse(result.value.value.toString()));
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(results);
    }
    async GetCandidate(ctx, candidateId) {
        const bytes = await ctx.stub.getState(`CANDIDATE_${candidateId}`);
        if (!bytes || bytes.length === 0) {
            throw new Error(`Candidate ${candidateId} does not exist`);
        }
        return bytes.toString();
    }
};
exports.VoteContract = VoteContract;
__decorate([
    (0, fabric_contract_api_1.Transaction)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "InitCandidates", null);
__decorate([
    (0, fabric_contract_api_1.Transaction)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "RegisterVoter", null);
__decorate([
    (0, fabric_contract_api_1.Transaction)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "CastVote", null);
__decorate([
    (0, fabric_contract_api_1.Transaction)(false),
    (0, fabric_contract_api_1.Returns)('string'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "GetResults", null);
__decorate([
    (0, fabric_contract_api_1.Transaction)(false),
    (0, fabric_contract_api_1.Returns)('string'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [fabric_contract_api_1.Context, String]),
    __metadata("design:returntype", Promise)
], VoteContract.prototype, "GetCandidate", null);
exports.VoteContract = VoteContract = __decorate([
    (0, fabric_contract_api_1.Info)({ title: 'VoteContract', description: 'Simple voting chaincode' })
], VoteContract);
