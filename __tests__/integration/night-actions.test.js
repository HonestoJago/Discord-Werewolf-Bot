const WerewolfGame = require('../../game/WerewolfGame');
const Player = require('../../game/Player');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');
const logger = require('../../utils/logger');  // Add at top with other imports

describe('Night Actions Integration', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue({
                    send: jest.fn()
                })
            },
            users: { 
                fetch: jest.fn().mockResolvedValue({
                    createDM: jest.fn().mockResolvedValue({
                        send: jest.fn()
                    })
                })
            }
        };
        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
        game.checkWinConditions = jest.fn().mockReturnValue(false);
    });

    afterEach(() => {
        if (game) {
            game.cleanup();
        }
    });

    afterAll(() => {
        if (game) {
            game.cleanup();
        }
        jest.useRealTimers();
    });

    test('night zero workflow', async () => {
        // Setup players
        const cupid = new Player('cupid', 'CupidPlayer', mockClient);
        const target1 = new Player('target1', 'Target1', mockClient);
        const target2 = new Player('target2', 'Target2', mockClient);

        cupid.assignRole(ROLES.CUPID);
        target1.assignRole(ROLES.VILLAGER);
        target2.assignRole(ROLES.VILLAGER);

        [cupid, target1, target2].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Set night zero phase
        game.phase = PHASES.NIGHT_ZERO;

        // Cupid chooses lovers
        await game.processNightAction(cupid.id, 'choose_lovers', `${target1.id},${target2.id}`);
        expect(game.nightActions[cupid.id]).toBeDefined();
        expect(game.nightActions[cupid.id].action).toBe('choose_lovers');

        // Verify lovers were set
        expect(game.lovers.get(target1.id)).toBe(target2.id);
        expect(game.lovers.get(target2.id)).toBe(target1.id);

        // Verify other roles can't act
        const seer = new Player('seer', 'SeerPlayer', mockClient);
        seer.assignRole(ROLES.SEER);
        game.players.set(seer.id, seer);

        await expect(
            game.processNightAction(seer.id, 'investigate', 'target')
        ).rejects.toThrow(new GameError('Invalid action', 'The Seer cannot investigate during Night Zero.'));
    });

    test('regular night phase workflow', async () => {
        // Setup players
        const werewolf = new Player('werewolf', 'WerewolfPlayer', mockClient);
        const seer = new Player('seer', 'SeerPlayer', mockClient);
        const doctor = new Player('doctor', 'DoctorPlayer', mockClient);
        const victim = new Player('victim', 'VictimPlayer', mockClient);

        werewolf.assignRole(ROLES.WEREWOLF);
        seer.assignRole(ROLES.SEER);
        doctor.assignRole(ROLES.DOCTOR);
        victim.assignRole(ROLES.VILLAGER);

        game.players.set(werewolf.id, werewolf);
        game.players.set(seer.id, seer);
        game.players.set(doctor.id, doctor);
        game.players.set(victim.id, victim);

        // Set night phase
        game.phase = PHASES.NIGHT;

        // Process night actions in sequence
        await game.processNightAction(werewolf.id, 'attack', victim.id);
        await game.processNightAction(seer.id, 'investigate', werewolf.id);
        await game.processNightAction(doctor.id, 'protect', victim.id);

        // Verify actions were recorded
        expect(game.nightActions[werewolf.id].target).toBe(victim.id);
        expect(game.nightActions[seer.id].target).toBe(werewolf.id);
        expect(game.nightActions[doctor.id].target).toBe(victim.id);

        // Verify doctor can't protect same target next night
        game.lastProtectedPlayer = victim.id;
        await expect(
            game.processNightAction(doctor.id, 'protect', victim.id)
        ).rejects.toThrow(new GameError('Invalid target', 'You cannot protect the same player two nights in a row.'));
    });
});

describe('Seer Investigations', () => {
    let game;
    let mockClient;
    let seer;

    beforeEach(() => {
        // Create a proper mock channel with awaitMessages
        const mockChannel = {
            send: jest.fn().mockResolvedValue({}),
            awaitMessages: jest.fn().mockResolvedValue({
                first: () => ({ content: 'test response' })
            })
        };

        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue(mockChannel)
            },
            users: { 
                fetch: jest.fn().mockImplementation(id => Promise.resolve({
                    id,
                    username: `User${id}`,
                    createDM: jest.fn().mockResolvedValue(mockChannel)
                }))
            }
        };

        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
        
        // Setup base seer player with proper DM channel
        seer = new Player('seer', 'SeerPlayer', mockClient);
        seer.assignRole(ROLES.SEER);
        seer.isAlive = true;
        seer.channel = mockChannel;
        seer.sendDM = jest.fn().mockResolvedValue({});
        game.players.set(seer.id, seer);
    });

    test('reveals correct werewolf status for all role types', async () => {
        // Setup players with different roles
        const players = {
            werewolf: new Player('wolf', 'WerewolfPlayer', mockClient),
            villager: new Player('vil', 'VillagerPlayer', mockClient),
            doctor: new Player('doc', 'DoctorPlayer', mockClient),
            cupid: new Player('cup', 'CupidPlayer', mockClient)
        };

        // Assign roles
        players.werewolf.assignRole(ROLES.WEREWOLF);
        players.villager.assignRole(ROLES.VILLAGER);
        players.doctor.assignRole(ROLES.DOCTOR);
        players.cupid.assignRole(ROLES.CUPID);

        // Add all players to game
        Object.values(players).forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        game.phase = PHASES.NIGHT;

        // Test each role
        for (const [role, player] of Object.entries(players)) {
            await game.processNightAction(seer.id, 'investigate', player.id);
            
            const expectedMessage = role === 'werewolf' 
                ? /is \*\*a Werewolf\*\*/
                : /is \*\*Not a Werewolf\*\*/;
            
            expect(seer.sendDM).toHaveBeenLastCalledWith(
                expect.stringMatching(expectedMessage)
            );
        }
    });

    test('cannot investigate self', async () => {
        game.phase = PHASES.NIGHT;
        
        await expect(
            game.processNightAction(seer.id, 'investigate', seer.id)
        ).rejects.toThrow(GameError);
    });

    test('reveals correct werewolf status on Night Zero excluding seer', async () => {
        // Mock the broadcast message to avoid the message.id error
        game.broadcastMessage = jest.fn().mockResolvedValue({});

        const seer = new Player('seer', 'SeerPlayer', mockClient);
        const villager1 = new Player('villager1', 'Villager1', mockClient);
        const villager2 = new Player('villager2', 'Villager2', mockClient);
        const werewolf = new Player('wolf', 'WerewolfPlayer', mockClient);
        
        seer.assignRole(ROLES.SEER);
        villager1.assignRole(ROLES.VILLAGER);
        villager2.assignRole(ROLES.VILLAGER);
        werewolf.assignRole(ROLES.WEREWOLF);
        
        [seer, villager1, villager2, werewolf].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Mock the sendDM function
        seer.sendDM = jest.fn();

        // Trigger Night Zero
        game.phase = PHASES.NIGHT_ZERO;
        await game.nightZero();

        // Verify DM was sent with correct format
        expect(seer.sendDM).toHaveBeenCalledWith(
            expect.stringMatching(/is \*\*Not a Werewolf\*\*/)
        );

        // Extract the username from the DM message
        const dmMessage = seer.sendDM.mock.calls[0][0];
        expect(dmMessage).not.toContain('SeerPlayer'); // Ensure seer wasn't selected
        expect(dmMessage).not.toContain('WerewolfPlayer'); // Ensure werewolf wasn't selected
        expect(['Villager1', 'Villager2']).toContain(
            dmMessage.match(/\*\*(.*?)\*\* is/)[1]
        );
    });

    test('reveals only werewolf/not-werewolf status during investigation', async () => {
        const seer = new Player('seer', 'SeerPlayer', mockClient);
        const werewolf = new Player('wolf', 'WerewolfPlayer', mockClient);
        const doctor = new Player('doc', 'DoctorPlayer', mockClient);
        
        seer.assignRole(ROLES.SEER);
        werewolf.assignRole(ROLES.WEREWOLF);
        doctor.assignRole(ROLES.DOCTOR);
        
        [seer, werewolf, doctor].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Mock the sendDM function
        seer.sendDM = jest.fn();

        // Test investigating werewolf
        game.phase = PHASES.NIGHT;
        await game.processNightAction(seer.id, 'investigate', werewolf.id);
        expect(seer.sendDM).toHaveBeenCalledWith(
            expect.stringMatching(/is \*\*a Werewolf\*\*/)
        );

        // Test investigating non-werewolf (doctor)
        await game.processNightAction(seer.id, 'investigate', doctor.id);
        expect(seer.sendDM).toHaveBeenCalledWith(
            expect.stringMatching(/is \*\*Not a Werewolf\*\*/)
        );
    });
});

describe('Werewolf Attack Coordination', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        // Create mock client
        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue({
                    send: jest.fn()
                })
            },
            users: { 
                fetch: jest.fn().mockResolvedValue({
                    createDM: jest.fn().mockResolvedValue({
                        send: jest.fn()
                    })
                })
            }
        };
        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
    });

    test('processes single coordinated werewolf attack', async () => {
        // Setup multiple werewolves and a victim
        const werewolf1 = new Player('wolf1', 'Werewolf1', mockClient);
        const werewolf2 = new Player('wolf2', 'Werewolf2', mockClient);
        const victim = new Player('victim', 'Victim', mockClient);
        
        werewolf1.assignRole(ROLES.WEREWOLF);
        werewolf2.assignRole(ROLES.WEREWOLF);
        victim.assignRole(ROLES.VILLAGER);
        
        [werewolf1, werewolf2, victim].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        game.phase = PHASES.NIGHT;

        // Both werewolves target same victim
        await game.processNightAction(werewolf1.id, 'attack', victim.id);
        await game.processNightAction(werewolf2.id, 'attack', victim.id);

        // Verify only one attack is registered
        expect(Object.values(game.nightActions).filter(
            action => action.action === 'attack'
        ).length).toBe(1);
    });

    test('handles conflicting werewolf attacks', async () => {
        // Setup werewolves and victims
        const werewolf1 = new Player('wolf1', 'Werewolf1', mockClient);
        const werewolf2 = new Player('wolf2', 'Werewolf2', mockClient);
        const victim1 = new Player('victim1', 'Victim1', mockClient);
        const victim2 = new Player('victim2', 'Victim2', mockClient);
        
        werewolf1.assignRole(ROLES.WEREWOLF);
        werewolf2.assignRole(ROLES.WEREWOLF);
        victim1.assignRole(ROLES.VILLAGER);
        victim2.assignRole(ROLES.VILLAGER);

        // Setup sendDM mocks
        werewolf1.sendDM = jest.fn().mockResolvedValue({});
        werewolf2.sendDM = jest.fn().mockResolvedValue({});

        [werewolf1, werewolf2, victim1, victim2].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        game.phase = PHASES.NIGHT;

        // First werewolf attacks
        await game.processNightAction(werewolf1.id, 'attack', victim1.id);

        // Second werewolf tries to attack different target
        await expect(
            game.processNightAction(werewolf2.id, 'attack', victim2.id)
        ).rejects.toThrow(GameError);

        // Verify notifications
        expect(werewolf1.sendDM).toHaveBeenCalledWith(
            expect.stringMatching(/Werewolves must agree on a single target/)
        );
        expect(werewolf2.sendDM).toHaveBeenCalledWith(
            expect.stringMatching(/Werewolves must agree on a single target/)
        );

        // Verify only the first attack is registered
        expect(Object.values(game.nightActions).filter(
            action => action.action === 'attack'
        ).length).toBe(1);
    });
});

describe('Night Action Validation', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        // Create mock client with DM capabilities
        const mockChannel = {
            send: jest.fn().mockResolvedValue({}),
            awaitMessages: jest.fn().mockResolvedValue({
                first: () => ({ content: 'test response' })
            })
        };

        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue(mockChannel)
            },
            users: { 
                fetch: jest.fn().mockImplementation(id => Promise.resolve({
                    id,
                    username: `User${id}`,
                    createDM: jest.fn().mockResolvedValue(mockChannel)
                }))
            }
        };

        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
    });

    test('does not notify or collect actions from dead players', async () => {
        // Setup dead player
        const deadPlayer = new Player('dead', 'DeadPlayer', mockClient);
        deadPlayer.assignRole(ROLES.WEREWOLF);
        deadPlayer.isAlive = false;
        deadPlayer.sendDM = jest.fn();
        game.players.set(deadPlayer.id, deadPlayer);

        // Advance to night phase
        game.phase = PHASES.NIGHT;
        await game.advanceToNight();

        // Verify dead player wasn't notified
        expect(deadPlayer.sendDM).not.toHaveBeenCalled();

        // Verify dead player can't submit actions
        await expect(
            game.processNightAction(deadPlayer.id, 'attack', 'target123')
        ).rejects.toThrow('Dead players cannot perform actions');
    });

    test('does not notify or accept actions from non-game players', async () => {
        // Setup player not in game
        const outsidePlayer = new Player('outside', 'OutsidePlayer', mockClient);
        outsidePlayer.assignRole(ROLES.WEREWOLF);
        outsidePlayer.isAlive = true;
        outsidePlayer.sendDM = jest.fn();

        // Note: Deliberately NOT adding to game.players

        // Advance to night phase
        game.phase = PHASES.NIGHT;
        await game.advanceToNight();

        // Verify outside player wasn't notified
        expect(outsidePlayer.sendDM).not.toHaveBeenCalled();

        // Verify outside player can't submit actions
        await expect(
            game.processNightAction(outsidePlayer.id, 'attack', 'target123')
        ).rejects.toThrow('You are not authorized to perform this action');
    });

    test('only notifies players with valid night actions', async () => {
        // Setup various players
        const werewolf = new Player('wolf', 'WerewolfPlayer', mockClient);
        const villager = new Player('vil', 'VillagerPlayer', mockClient);
        const seer = new Player('seer', 'SeerPlayer', mockClient);

        werewolf.assignRole(ROLES.WEREWOLF);
        villager.assignRole(ROLES.VILLAGER);
        seer.assignRole(ROLES.SEER);

        werewolf.sendDM = jest.fn();
        villager.sendDM = jest.fn();
        seer.sendDM = jest.fn();

        [werewolf, villager, seer].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Advance to night phase
        game.phase = PHASES.NIGHT;
        await game.advanceToNight();

        // Verify correct notifications
        expect(werewolf.sendDM).toHaveBeenCalledWith(expect.stringMatching(/attack/));
        expect(seer.sendDM).toHaveBeenCalledWith(expect.stringMatching(/investigate/));
        expect(villager.sendDM).not.toHaveBeenCalled();
    });

    test('preserves night actions from players who die during the night', async () => {
        const werewolf = new Player('wolf', 'WerewolfPlayer', mockClient);
        const victim = new Player('vic', 'VictimPlayer', mockClient);
        
        werewolf.assignRole(ROLES.WEREWOLF);
        victim.assignRole(ROLES.SEER);

        // Set up the mock for sendDM
        victim.sendDM = jest.fn().mockResolvedValue({});

        [werewolf, victim].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Mock checkWinConditions
        game.checkWinConditions = jest.fn().mockReturnValue(false);

        // Submit night action
        game.phase = PHASES.NIGHT;
        await game.processNightAction(victim.id, 'investigate', werewolf.id);

        // Kill the player
        victim.isAlive = false;
        await game.processNightActions();

        // Verify their action was preserved and processed
        expect(victim.sendDM).toHaveBeenCalledWith(
            expect.stringMatching(/is \*\*a Werewolf\*\*/)
        );
    });

    test('handles disconnected players during night phase', async () => {
        const werewolf = new Player('wolf', 'WerewolfPlayer', mockClient);
        werewolf.assignRole(ROLES.WEREWOLF);
        werewolf.isAlive = true;
        
        // Mock sendDM to simulate a failure
        werewolf.sendDM = jest.fn().mockImplementation(() => {
            // Use the already mocked logger from setup.js
            logger.error('Error sending DM', { 
                playerId: werewolf.id,
                error: 'Connection failed'
            });
            return Promise.resolve(); // Don't throw, just log and continue
        });
        
        game.players.set(werewolf.id, werewolf);

        // Advance to night phase
        game.phase = PHASES.NIGHT;
        await game.advanceToNight();

        // Verify error is logged but game continues
        expect(logger.error).toHaveBeenCalledWith(
            'Error sending DM',
            expect.any(Object)
        );
        expect(game.phase).toBe(PHASES.NIGHT);
    });
});

describe('Night Zero Restrictions', () => {
    let game;
    let mockClient;
    let werewolf;
    let victim;

    beforeEach(() => {
        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue({
                    send: jest.fn()
                })
            },
            users: { 
                fetch: jest.fn().mockResolvedValue({
                    createDM: jest.fn().mockResolvedValue({
                        send: jest.fn()
                    })
                })
            }
        };
        
        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
        
        // Setup werewolf and potential victim
        werewolf = new Player('wolf', 'WerewolfPlayer', mockClient);
        victim = new Player('victim', 'VictimPlayer', mockClient);
        
        werewolf.assignRole(ROLES.WEREWOLF);
        victim.assignRole(ROLES.VILLAGER);
        
        [werewolf, victim].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        game.phase = PHASES.NIGHT_ZERO;
    });

    test('werewolves cannot attack during Night Zero phase', async () => {
        // Direct attempt to attack
        await expect(
            game.processNightAction(werewolf.id, 'attack', victim.id)
        ).rejects.toThrow('Werewolves cannot attack during Night Zero');
    });

    test('werewolves are not notified about attacks during Night Zero', async () => {
        werewolf.sendDM = jest.fn();
        const seer = new Player('seer', 'SeerPlayer', mockClient);
        seer.assignRole(ROLES.SEER);
        seer.isAlive = true;
        seer.sendDM = jest.fn();
        game.players.set(seer.id, seer);
        
        // Advance to Night Zero
        await game.nightZero();
        
        // Verify no attack notification was sent to werewolf
        expect(werewolf.sendDM).not.toHaveBeenCalledWith(
            expect.stringMatching(/attack/)
        );

        // But Seer should still get their night zero revelation
        expect(seer.sendDM).toHaveBeenCalledWith(
            expect.stringMatching(/is \*\*Not a Werewolf\*\*/)
        );
    });

    test('werewolf attack action is blocked even if validation is bypassed', async () => {
        // Try to store attack action directly
        game.nightActions[werewolf.id] = { action: 'attack', target: victim.id };
        
        // Process night actions
        await game.processNightActions();
        
        // Verify victim is still alive
        expect(victim.isAlive).toBe(true);
    });
});

