const WerewolfGame = require('../../game/WerewolfGame');
const Player = require('../../game/Player');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');

describe('Game Phase Integration', () => {
    let game;
    let mockClient;
    let mockChannel;

    beforeEach(() => {
        jest.useFakeTimers();
        mockChannel = {
            send: jest.fn().mockResolvedValue({ id: 'message123' }),
            messages: {
                fetch: jest.fn()
            },
            awaitMessages: jest.fn().mockResolvedValue({
                first: () => ({ content: 'test response' })
            })
        };

        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue(mockChannel)
            },
            users: { 
                fetch: jest.fn().mockResolvedValue({
                    createDM: jest.fn().mockResolvedValue(mockChannel),
                    username: 'TestUser'
                })
            }
        };

        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
    });

    afterEach(() => {
        jest.useRealTimers();
        if (game) {
            game.cleanup();
        }
    });

    describe('Day Phase', () => {
        test('complete day phase workflow', async () => {
            // Setup players
            const nominator = new Player('nom', 'Nominator', mockClient);
            const seconder = new Player('sec', 'Seconder', mockClient);
            const voter = new Player('voter', 'Voter', mockClient);
            const target = new Player('target', 'Target', mockClient);
            
            [nominator, seconder, voter, target].forEach(p => {
                p.assignRole(ROLES.VILLAGER);
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            // Start day phase
            await game.advanceToDay();
            expect(game.phase).toBe(PHASES.DAY);

            // Verify day phase GUI
            expect(mockChannel.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: [expect.any(Object)],  // Just verify it's an embed object
                    components: [expect.any(Object)]  // Just verify it has components
                })
            );

            // Test nomination
            await game.nominate(nominator.id, target.id);
            expect(game.phase).toBe(PHASES.NOMINATION);
            expect(game.nominatedPlayer).toBe(target.id);

            // Test seconding
            await game.second(seconder.id);
            expect(game.phase).toBe(PHASES.VOTING);
            expect(game.votingOpen).toBe(true);

            // Test voting
            await game.submitVote(nominator.id, true);   // guilty
            await game.submitVote(seconder.id, true);    // guilty
            await game.submitVote(voter.id, false);      // innocent
            await game.submitVote(target.id, false);     // innocent

            // Process votes
            const result = await game.processVotes();

            // Verify results
            expect(result.votesFor).toBe(2);
            expect(result.votesAgainst).toBe(2);
            expect(target.isAlive).toBe(true); // Tie means no elimination
        });

        test('handles failed nomination (no second)', async () => {
            const nominator = new Player('nom', 'Nominator', mockClient);
            const target = new Player('target', 'Target', mockClient);
            
            [nominator, target].forEach(p => {
                p.assignRole(ROLES.VILLAGER);
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            game.phase = PHASES.DAY;
            await game.nominate(nominator.id, target.id);

            // Clear previous calls
            mockChannel.send.mockClear();

            // Advance timers and wait for promises to resolve
            jest.advanceTimersByTime(game.NOMINATION_WAIT_TIME + 100);
            await Promise.resolve(); // Let promises resolve

            expect(game.phase).toBe(PHASES.DAY);
            expect(game.nominatedPlayer).toBeNull();
            expect(mockChannel.send).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    embeds: [expect.objectContaining({
                        title: 'Nomination Failed'
                    })]
                })
            );
        });

        test('handles tie votes', async () => {
            // Equal votes scenario
        });
    });

    describe('Night Phase', () => {
        test('complete night phase workflow', async () => {
            // Setup players
            const werewolf = new Player('wolf', 'Werewolf', mockClient);
            const doctor = new Player('doc', 'Doctor', mockClient);
            const victim = new Player('vic', 'Victim', mockClient);

            werewolf.assignRole(ROLES.WEREWOLF);
            doctor.assignRole(ROLES.DOCTOR);
            victim.assignRole(ROLES.VILLAGER);

            [werewolf, doctor, victim].forEach(p => {
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            // Mock checkWinConditions to return false
            game.checkWinConditions = jest.fn().mockReturnValue(false);

            // Start night phase
            game.phase = PHASES.NIGHT;

            // Process night actions
            await game.processNightAction(doctor.id, 'protect', victim.id);
            game.lastProtectedPlayer = victim.id;
            await game.processNightAction(werewolf.id, 'attack', victim.id);

            // Advance phase and wait for all promises to resolve
            await game.advancePhase();
            
            // Verify results
            expect(game.checkWinConditions).toHaveBeenCalled();
            expect(victim.isAlive).toBe(true);
            expect(game.phase).toBe(PHASES.DAY);
        }, 10000); // Add timeout just in case
    });

    // Phase Transition Tests
    describe('Phase Transitions', () => {
        test('day to night transition', async () => {});
        test('night to day transition', async () => {});
        test('night zero to day transition', async () => {});
    });
});
