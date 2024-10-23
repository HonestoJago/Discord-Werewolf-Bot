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

    describe('Win Conditions', () => {
        let game;
        let mockClient;

        beforeEach(() => {
            const mockChannel = {
                send: jest.fn().mockResolvedValue({ id: 'message123' }),
                messages: {
                    fetch: jest.fn()
                }
            };

            mockClient = {
                channels: { 
                    fetch: jest.fn().mockResolvedValue(mockChannel)
                },
                users: { 
                    fetch: jest.fn().mockResolvedValue({
                        createDM: jest.fn().mockResolvedValue(mockChannel)
                    })
                }
            };

            game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
        });

        test('villagers win when all werewolves are eliminated', async () => {
            // Setup: 1 werewolf, 2 villagers, 1 doctor
            const players = {
                werewolf: new Player('wolf', 'Werewolf', mockClient),
                villager1: new Player('vil1', 'Villager1', mockClient),
                villager2: new Player('vil2', 'Villager2', mockClient),
                doctor: new Player('doc', 'Doctor', mockClient)
            };

            players.werewolf.assignRole(ROLES.WEREWOLF);
            players.villager1.assignRole(ROLES.VILLAGER);
            players.villager2.assignRole(ROLES.VILLAGER);
            players.doctor.assignRole(ROLES.DOCTOR);

            Object.values(players).forEach(p => {
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            // Kill the werewolf
            players.werewolf.isAlive = false;

            // Mock broadcast message
            game.broadcastMessage = jest.fn();

            // Check win conditions
            const result = game.checkWinConditions();

            // Verify villager victory
            expect(result).toBe(true);
            expect(game.broadcastMessage).toHaveBeenCalledWith(
                expect.stringMatching(/Villagers win/)
            );
        });

        test('werewolves win when they reach parity with villagers', async () => {
            // Setup: 2 werewolves, 2 villagers (one about to die)
            const players = {
                werewolf1: new Player('wolf1', 'Werewolf1', mockClient),
                werewolf2: new Player('wolf2', 'Werewolf2', mockClient),
                villager1: new Player('vil1', 'Villager1', mockClient),
                villager2: new Player('vil2', 'Villager2', mockClient)
            };

            players.werewolf1.assignRole(ROLES.WEREWOLF);
            players.werewolf2.assignRole(ROLES.WEREWOLF);
            players.villager1.assignRole(ROLES.VILLAGER);
            players.villager2.assignRole(ROLES.VILLAGER);

            Object.values(players).forEach(p => {
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            // Kill one villager to reach parity (2 werewolves vs 1 villager)
            players.villager1.isAlive = false;

            // Mock broadcast message
            game.broadcastMessage = jest.fn();

            // Check win conditions
            const result = game.checkWinConditions();

            // Verify werewolf victory
            expect(result).toBe(true);
            expect(game.broadcastMessage).toHaveBeenCalledWith(
                expect.stringMatching(/Werewolves win/)
            );
        });

        test('game continues when no win condition is met', async () => {
            // Setup: 1 werewolf, 2 villagers
            const players = {
                werewolf: new Player('wolf', 'Werewolf', mockClient),
                villager1: new Player('vil1', 'Villager1', mockClient),
                villager2: new Player('vil2', 'Villager2', mockClient)
            };

            players.werewolf.assignRole(ROLES.WEREWOLF);
            players.villager1.assignRole(ROLES.VILLAGER);
            players.villager2.assignRole(ROLES.VILLAGER);

            Object.values(players).forEach(p => {
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            // Mock broadcast message
            game.broadcastMessage = jest.fn();

            // Check win conditions
            const result = game.checkWinConditions();

            // Verify game continues
            expect(result).toBe(false);
            expect(game.broadcastMessage).not.toHaveBeenCalled();
        });

        test('special roles count as villagers for win conditions', async () => {
            // Setup: 1 werewolf, 1 doctor, 1 cupid (about to reach parity)
            const players = {
                werewolf: new Player('wolf', 'Werewolf', mockClient),
                doctor: new Player('doc', 'Doctor', mockClient),
                cupid: new Player('cup', 'Cupid', mockClient)
            };

            players.werewolf.assignRole(ROLES.WEREWOLF);
            players.doctor.assignRole(ROLES.DOCTOR);
            players.cupid.assignRole(ROLES.CUPID);

            Object.values(players).forEach(p => {
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            // Kill one special role
            players.cupid.isAlive = false;

            // Mock broadcast message
            game.broadcastMessage = jest.fn();

            // Check win conditions
            const result = game.checkWinConditions();

            // Verify werewolf victory (1 werewolf vs 1 villager-team)
            expect(result).toBe(true);
            expect(game.broadcastMessage).toHaveBeenCalledWith(
                expect.stringMatching(/Werewolves win/)
            );
        });
    });
});
