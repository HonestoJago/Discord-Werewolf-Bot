// Move all individual method tests here
// - validateNightAction tests
// - submitVote tests
// - nominate tests
// - second tests
// - processVotes tests
// Each method tested in isolation

const WerewolfGame = require('../../game/WerewolfGame');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');

describe('WerewolfGame', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        mockClient = {
            channels: { fetch: jest.fn() },
            users: { fetch: jest.fn() }
        };
        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
    });

    describe('Vote Methods', () => {
        describe('submitVote', () => {
            test('accepts valid vote', async () => {
                game.phase = PHASES.VOTING;
                game.votingOpen = true;
                const voter = { id: 'voter', isAlive: true };
                game.players.set(voter.id, voter);

                await game.submitVote('voter', true);
                expect(game.votes.get('voter')).toBe(true);
            });
            // ... other vote tests
        });

        describe('processVotes', () => {
            // Vote processing tests
        });
    });

    describe('Nomination Methods', () => {
        describe('nominate', () => {
            // Nomination validation tests
        });

        describe('second', () => {
            // Second validation tests
        });
    });

    describe('Night Actions', () => {
        // Move night action tests here
    });

    describe('Voting System', () => {
        // Move voting tests here
    });

    describe('Phase Management', () => {
        // Add phase transition tests
    });

    // ... other method tests
});
