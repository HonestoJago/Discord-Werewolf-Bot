const Discord = require('discord.js');
const WerewolfGame = require('../../game/WerewolfGame');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');
const { PermissionsBitField } = require('discord.js');
const { GameError } = require('../../utils/error-handler');  // Add this import

// Mock Discord.js
jest.mock('discord.js');

// Add this at the top of the file, before any describe blocks
let mockClient;
let mockGuild;
let mockChannel;

beforeEach(() => {
    // Define permission flags
    const PERMISSION_FLAGS = {
        VIEW_CHANNEL: 1n << 2n,
        SEND_MESSAGES: 1n << 11n,
        READ_MESSAGE_HISTORY: 1n << 16n,
    };

    // Setup mock channel with all required methods
    mockChannel = {
        send: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        permissionOverwrites: {
            create: jest.fn().mockResolvedValue(true),
        },
        setPermissions: jest.fn().mockResolvedValue({}),
        id: 'mock-channel-id',
    };

    // Setup mock guild with improved channel creation
    mockGuild = {
        channels: {
            create: jest.fn().mockImplementation((name, options) => {
                const newChannel = {
                    ...mockChannel,
                    name: typeof name === 'string' ? name : name.name,
                    type: typeof name === 'string' ? 0 : (name.type || 0),
                    id: `${typeof name === 'string' ? name : name.name}-id`,
                    permissionOverwrites: {
                        create: jest.fn().mockResolvedValue(true),
                    },
                };
                return Promise.resolve(newChannel);
            }),
            fetch: jest.fn().mockResolvedValue(mockChannel),
        },
        roles: {
            everyone: { id: 'everyone-role-id' },
            create: jest.fn().mockResolvedValue({ id: 'role-id' }),
        },
        members: {
            fetch: jest.fn().mockImplementation((userId) => {
                return Promise.resolve({
                    id: userId,
                    roles: {
                        add: jest.fn().mockResolvedValue(true),
                        remove: jest.fn().mockResolvedValue(true),
                    },
                });
            }),
        },
    };

    // Setup mock client
    mockClient = {
        guilds: {
            fetch: jest.fn().mockResolvedValue(mockGuild),
        },
        channels: {
            fetch: jest.fn().mockResolvedValue(mockChannel),
        },
        users: {
            fetch: jest.fn().mockImplementation((userId) => {
                return Promise.resolve({
                    id: userId,
                    username: `User_${userId}`,
                    createDM: jest.fn().mockResolvedValue(mockChannel),
                });
            }),
        },
    };
});

describe('WerewolfGame', () => {
    let mockClient;
    let mockGuild;
    let mockChannel;

    beforeEach(() => {
        // Define permission flags
        const PERMISSION_FLAGS = {
            VIEW_CHANNEL: 1n << 2n,
            SEND_MESSAGES: 1n << 11n,
            READ_MESSAGE_HISTORY: 1n << 16n,
        };

        // Setup mock channel with all required methods
        mockChannel = {
            send: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
            permissionOverwrites: {
                create: jest.fn().mockResolvedValue(true),
            },
            setPermissions: jest.fn().mockResolvedValue({}),
            id: 'mock-channel-id',
        };

        // Setup mock guild with improved channel creation
        mockGuild = {
            channels: {
                create: jest.fn().mockImplementation((name, options) => {
                    const newChannel = {
                        ...mockChannel,
                        name: typeof name === 'string' ? name : name.name,
                        type: typeof name === 'string' ? 0 : (name.type || 0),
                        id: `${typeof name === 'string' ? name : name.name}-id`,
                        permissionOverwrites: {
                            create: jest.fn().mockResolvedValue(true),
                        },
                    };
                    return Promise.resolve(newChannel);
                }),
                fetch: jest.fn().mockResolvedValue(mockChannel),
            },
            roles: {
                everyone: { id: 'everyone-role-id' },
                create: jest.fn().mockResolvedValue({ id: 'role-id' }),
            },
            members: {
                fetch: jest.fn().mockImplementation((userId) => {
                    return Promise.resolve({
                        id: userId,
                        roles: {
                            add: jest.fn().mockResolvedValue(true),
                            remove: jest.fn().mockResolvedValue(true),
                        },
                    });
                }),
            },
        };

        // Setup mock client
        mockClient = {
            guilds: {
                fetch: jest.fn().mockResolvedValue(mockGuild),
            },
            channels: {
                fetch: jest.fn().mockResolvedValue(mockChannel),
            },
            users: {
                fetch: jest.fn().mockImplementation((userId) => {
                    return Promise.resolve({
                        id: userId,
                        username: `User_${userId}`,
                        createDM: jest.fn().mockResolvedValue(mockChannel),
                    });
                }),
            },
        };
    });

    describe('Initialization', () => {
        test('initializes with correct default values', () => {
            const game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
            
            expect(game.phase).toBe(PHASES.LOBBY);
            expect(game.round).toBe(0);
            expect(game.players.size).toBe(0);
            expect(game.selectedRoles.size).toBe(0);
            expect(game.gameOver).toBe(false);
        });

        test('stores constructor parameters', () => {
            const game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1', ['auth1']);
            
            expect(game.client).toBe(mockClient);
            expect(game.guildId).toBe('guild1');
            expect(game.gameChannelId).toBe('channel1');
            expect(game.gameCreatorId).toBe('creator1');
            expect(game.authorizedIds).toEqual(['auth1']);
        });
    });

    describe('Player Management', () => {
        let game;
        
        beforeEach(() => {
            game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
        });

        test('can add player in lobby phase', () => {
            const mockUser = { id: 'user1', username: 'TestUser' };
            const player = game.addPlayer(mockUser);
            
            expect(game.players.get(mockUser.id)).toBe(player);
            expect(player.username).toBe(mockUser.username);
        });

        test('cannot add same player twice', () => {
            const mockUser = { id: 'user1', username: 'TestUser' };
            game.addPlayer(mockUser);
            
            expect(() => game.addPlayer(mockUser))
                .toThrow('Player already in game');
        });

        test('cannot add player after game starts', async () => {
            // Setup minimum requirements for game start
            game.selectedRoles.set(ROLES.WEREWOLF, 2);
            game.selectedRoles.set(ROLES.VILLAGER, 4);
            
            // Add minimum players
            for (let i = 0; i < 6; i++) {
                game.addPlayer({ id: `user${i}`, username: `User${i}` });
            }
            
            await game.startGame();
            
            const newUser = { id: 'newUser', username: 'NewUser' };
            expect(() => game.addPlayer(newUser))
                .toThrow('Cannot join a game in progress');
        });
    });

    describe('Role Management', () => {
        test('assigns roles based on configuration', () => {
            const game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
            game.selectedRoles = new Map([[ROLES.WEREWOLF, 1]]);
            const mockUser = { id: 'user1', username: 'TestUser' };
            game.addPlayer(mockUser);
            game.assignRoles();
            expect(game.players.get(mockUser.id).role).toBe(ROLES.WEREWOLF);
        });
    });

    describe('Game Start', () => {
        let game;
        
        beforeEach(() => {
            game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
        });

        test('transitions through NIGHT_ZERO when starting game', async () => {
            // Setup game with only Werewolves and Villagers (no Cupid)
            game.selectedRoles.set(ROLES.WEREWOLF, 2);
            game.selectedRoles.set(ROLES.VILLAGER, 4);
            
            // Add required players
            for (let i = 0; i < 6; i++) {
                game.addPlayer({ id: `user${i}`, username: `User${i}` });
            }

            // Mock the advancePhase method to capture the NIGHT_ZERO transition
            const originalAdvancePhase = game.advancePhase;
            let sawNightZero = false;
            game.advancePhase = async function() {
                if (this.phase === PHASES.NIGHT_ZERO) {
                    sawNightZero = true;
                }
                return originalAdvancePhase.call(this);
            };

            await game.startGame();
            expect(sawNightZero).toBe(true);
            expect(mockGuild.channels.create).toHaveBeenCalled();
        });

        test('ends in DAY phase when starting game without Cupid', async () => {
            // Setup game with only Werewolves and Villagers
            game.selectedRoles.set(ROLES.WEREWOLF, 2);
            game.selectedRoles.set(ROLES.VILLAGER, 4);
            
            // Add required players
            for (let i = 0; i < 6; i++) {
                game.addPlayer({ id: `user${i}`, username: `User${i}` });
            }

            await game.startGame();
            expect(game.phase).toBe(PHASES.DAY);
            expect(game.round).toBe(1);
        });
    });

    describe('Phase Transitions', () => {
        let game;
        
        beforeEach(() => {
            game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
            // Setup game with only Werewolves and Villagers (no Cupid)
            game.selectedRoles.set(ROLES.WEREWOLF, 2);
            game.selectedRoles.set(ROLES.VILLAGER, 4);
            
            for (let i = 0; i < 6; i++) {
                game.addPlayer({ id: `user${i}`, username: `User${i}` });
            }
        });

        test('advances from NIGHT_ZERO to DAY when no Cupid', async () => {
            await game.startGame();
            // Since there's no Cupid, it should advance automatically
            expect(game.phase).toBe(PHASES.DAY);
            expect(game.round).toBe(1);
        });

        test('advances from NIGHT_ZERO to DAY after Cupid action', async () => {
            // Reset game with Cupid
            game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
            game.selectedRoles.set(ROLES.WEREWOLF, 2);
            game.selectedRoles.set(ROLES.VILLAGER, 3);
            game.selectedRoles.set(ROLES.CUPID, 1);
            
            for (let i = 0; i < 6; i++) {
                game.addPlayer({ id: `user${i}`, username: `User${i}` });
            }

            await game.startGame();
            expect(game.phase).toBe(PHASES.NIGHT_ZERO);
            
            // Simulate Cupid's action completion
            await game.processNightActions();
            expect(game.phase).toBe(PHASES.DAY);
            expect(game.round).toBe(1);
        });
    });

    describe('Role Validation', () => {
        let game;
        
        beforeEach(async () => {
            game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
            game.selectedRoles.set(ROLES.WEREWOLF, 1);
            game.selectedRoles.set(ROLES.VILLAGER, 5);
            
            // Add players
            for (let i = 0; i < 6; i++) {
                game.addPlayer({ id: `user${i}`, username: `User${i}` });
            }
            
            await game.startGame();
        });

        test('validates role counts', () => {
            const werewolfCount = Array.from(game.players.values())
                .filter(p => p.role === ROLES.WEREWOLF)
                .length;
            
            expect(werewolfCount).toBe(1);
        });

        test('ensures all players have roles', () => {
            const playersWithoutRoles = Array.from(game.players.values())
                .filter(p => !p.role);
            
            expect(playersWithoutRoles.length).toBe(0);
        });
    });

    // Add more test suites as needed
});

// Add these new test suites after the existing ones

describe('Night Actions', () => {
    let game;
    
    beforeEach(() => {
        game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
        // Setup basic game with all roles
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.SEER, 1);
        game.selectedRoles.set(ROLES.DOCTOR, 1);
        game.selectedRoles.set(ROLES.VILLAGER, 2);
    });

    test('werewolf can submit attack action', async () => {
        // Add players and start game
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        await game.startGame();
        game.phase = PHASES.NIGHT;  // Add this line

        const werewolf = Array.from(game.players.values()).find(p => p.role === ROLES.WEREWOLF);
        const victim = Array.from(game.players.values()).find(p => p.role !== ROLES.WEREWOLF);

        await game.processNightAction(werewolf.id, 'attack', victim.id);
        expect(game.nightActions[werewolf.id]).toEqual({
            action: 'attack',
            target: victim.id
        });
    });

    test('seer can investigate players', async () => {
        // Add players and start game
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        await game.startGame();
        game.phase = PHASES.NIGHT;  // Add this line

        const seer = Array.from(game.players.values()).find(p => p.role === ROLES.SEER);
        const target = Array.from(game.players.values()).find(p => p.id !== seer.id);

        await game.processNightAction(seer.id, 'investigate', target.id);
        expect(game.nightActions[seer.id]).toEqual({
            action: 'investigate',
            target: target.id
        });
    });

    test('doctor cannot protect same player twice in a row', async () => {
        // Add players and start game
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        await game.startGame();
        game.phase = PHASES.NIGHT; // Ensure we're in night phase

        // Find doctor and target
        const doctor = Array.from(game.players.values()).find(p => p.role === ROLES.DOCTOR);
        const target = Array.from(game.players.values()).find(p => p.id !== doctor.id);

        // First protection should work
        await game.processNightAction(doctor.id, 'protect', target.id);
        expect(game.lastProtectedPlayer).toBe(target.id);

        // Second protection should fail with exact error message
        await expect(game.processNightAction(doctor.id, 'protect', target.id))
            .rejects.toThrow('Invalid target');
    });
});

describe('Voting System', () => {
    let game;
    
    beforeEach(async () => {
        game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.VILLAGER, 4);
        
        // Add players
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();
    });

    test('can nominate player during day phase', async () => {
        const nominator = Array.from(game.players.values())[0];
        const target = Array.from(game.players.values())[1];

        await game.nominate(nominator.id, target.id);
        expect(game.phase).toBe(PHASES.NOMINATION);
        expect(game.nominatedPlayer).toBe(target.id);
        expect(game.nominator).toBe(nominator.id);
    });

    test('cannot nominate during night phase', async () => {
        game.phase = PHASES.NIGHT;
        const nominator = Array.from(game.players.values())[0];
        const target = Array.from(game.players.values())[1];

        await expect(game.nominate(nominator.id, target.id))
            .rejects.toThrow('Wrong phase');
    });

    test('processes votes correctly', async () => {
        // Setup nomination
        const nominator = Array.from(game.players.values())[0];
        const target = Array.from(game.players.values())[1];
        await game.nominate(nominator.id, target.id);
        await game.second(Array.from(game.players.values())[2].id);

        // Submit votes
        for (const player of Array.from(game.players.values())) {
            if (player.id !== target.id) {  // Target can't vote
                await game.submitVote(player.id, true);  // All vote guilty
            }
        }

        const result = await game.processVotes();
        expect(result.eliminated).toBe(target.id);
        expect(target.isAlive).toBe(false);
    });
});

describe('Win Conditions', () => {
    let game;
    
    beforeEach(() => {
        game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
    });

    test('werewolves win when reaching parity', async () => {
        // Setup game with 3 werewolves, 3 villagers (minimum 6 players)
        game.selectedRoles.set(ROLES.WEREWOLF, 3);
        game.selectedRoles.set(ROLES.VILLAGER, 3);
        
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();

        // Kill two villagers to reach parity
        const villagers = Array.from(game.players.values())
            .filter(p => p.role !== ROLES.WEREWOLF)
            .slice(0, 2);
        
        villagers.forEach(v => v.isAlive = false);

        const result = game.checkWinConditions();
        expect(result).toBe(true);
        expect(game.gameOver).toBe(true);
    });

    test('villagers win when all werewolves die', async () => {
        // Setup game with 2 werewolves, 4 villagers (minimum 6 players)
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.VILLAGER, 4);
        
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();

        // Kill all werewolves
        const werewolves = Array.from(game.players.values())
            .filter(p => p.role === ROLES.WEREWOLF);
        
        werewolves.forEach(w => w.isAlive = false);

        const result = game.checkWinConditions();
        expect(result).toBe(true);
        expect(game.gameOver).toBe(true);
    });
});

// Add these new test suites

describe('Role Interactions', () => {
    let game;
    
    beforeEach(async () => {
        game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
        // Setup game with all special roles
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.SEER, 1);
        game.selectedRoles.set(ROLES.DOCTOR, 1);
        game.selectedRoles.set(ROLES.CUPID, 1);
        game.selectedRoles.set(ROLES.VILLAGER, 1);
        
        // Add 6 players
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();
    });

    test('doctor can protect werewolf attack target', async () => {
        game.phase = PHASES.NIGHT;
        
        const werewolf = Array.from(game.players.values()).find(p => p.role === ROLES.WEREWOLF);
        const doctor = Array.from(game.players.values()).find(p => p.role === ROLES.DOCTOR);
        const target = Array.from(game.players.values())
            .find(p => p.role !== ROLES.WEREWOLF && p.id !== doctor.id);

        // Werewolf attacks target
        await game.processNightAction(werewolf.id, 'attack', target.id);
        // Doctor protects target
        await game.processNightAction(doctor.id, 'protect', target.id);

        await game.processNightActions();
        expect(target.isAlive).toBe(true);
    });

    test('lovers die together', async () => {
        const cupid = Array.from(game.players.values()).find(p => p.role === ROLES.CUPID);
        const [lover1, lover2] = Array.from(game.players.values())
            .filter(p => p.id !== cupid.id)
            .slice(0, 2);

        // Set up lovers directly using processLoverSelection instead of processNightAction
        await game.processLoverSelection(cupid.id, `${lover1.id},${lover2.id}`);
        expect(game.lovers.get(lover1.id)).toBe(lover2.id);
        expect(game.lovers.get(lover2.id)).toBe(lover1.id);

        // Kill one lover
        lover1.isAlive = false;
        await game.handleLoversDeath(lover1);

        expect(lover2.isAlive).toBe(false);
    });

    test('seer correctly identifies werewolf', async () => {
        game.phase = PHASES.NIGHT;
        
        const seer = Array.from(game.players.values()).find(p => p.role === ROLES.SEER);
        const werewolf = Array.from(game.players.values()).find(p => p.role === ROLES.WEREWOLF);

        // Clear previous mock calls
        mockChannel.send.mockClear();

        await game.processSeerInvestigation(seer.id, werewolf.id);
        expect(mockChannel.send).toHaveBeenCalledWith(
            expect.stringContaining(`**${werewolf.username}** is **a Werewolf**`)
        );
    });
});

describe('Game State Management', () => {
    let game;
    
    beforeEach(() => {
        game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
    });

    test('cannot configure roles after game starts', async () => {
        // Setup and start game
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.VILLAGER, 4);
        
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();

        // Attempt to add role after game starts
        expect(() => {
            game.addRole(ROLES.SEER);
        }).toThrow('Cannot modify roles');  // Match the actual error message
    });

    test('dead players cannot perform actions', async () => {
        // Setup game
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.VILLAGER, 4);
        
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();

        // Kill a werewolf
        const werewolf = Array.from(game.players.values()).find(p => p.role === ROLES.WEREWOLF);
        werewolf.isAlive = false;

        // Attempt action with dead werewolf
        await expect(game.processNightAction(werewolf.id, 'attack', 'someTarget'))
            .rejects.toThrow('Dead players cannot perform actions');
    });

    test('cleanup removes private channels', async () => {
        // Setup and start game
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.VILLAGER, 4);
        
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();

        // Create mock channels with all required methods
        const mockWerewolfChannel = { 
            delete: jest.fn().mockResolvedValue(true),
            send: jest.fn().mockResolvedValue({}),
            permissionOverwrites: {
                create: jest.fn().mockResolvedValue(true)
            },
            permissionsFor: jest.fn().mockReturnValue({
                has: jest.fn().mockReturnValue(true)  // Mock having MANAGE_CHANNELS permission
            })
        };
        const mockDeadChannel = { 
            delete: jest.fn().mockResolvedValue(true),
            send: jest.fn().mockResolvedValue({}),
            permissionOverwrites: {
                create: jest.fn().mockResolvedValue(true)
            },
            permissionsFor: jest.fn().mockReturnValue({
                has: jest.fn().mockReturnValue(true)  // Mock having MANAGE_CHANNELS permission
            })
        };

        // Replace the actual channels with our mocks
        game.werewolfChannel = mockWerewolfChannel;
        game.deadChannel = mockDeadChannel;

        // Call shutdown
        await game.shutdownGame();

        // Verify cleanup
        expect(mockWerewolfChannel.delete).toHaveBeenCalled();
        expect(mockDeadChannel.delete).toHaveBeenCalled();
        expect(game.werewolfChannel).toBeNull();
        expect(game.deadChannel).toBeNull();
    });
});

describe('Error Handling', () => {
    let game;
    
    beforeEach(() => {
        game = new WerewolfGame(mockClient, 'guild1', 'channel1', 'creator1');
    });

    test('handles invalid role configuration', async () => {
        // Add required players first
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        // Try to start with no roles configured
        await expect(game.startGame())
            .rejects.toThrow('Roles Not Configured');
    });

    test('handles invalid night action targets', async () => {
        // Setup game
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.VILLAGER, 4);
        
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();
        game.phase = PHASES.NIGHT;

        const werewolf = Array.from(game.players.values()).find(p => p.role === ROLES.WEREWOLF);
        
        // Try to attack invalid target
        try {
            await game.processNightAction(werewolf.id, 'attack', 'invalid-id');
            fail('Expected an error to be thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(GameError);
            expect(error.message).toBe('Invalid target');
        }
    });

    test('handles invalid vote submissions', async () => {
        // Setup game
        game.selectedRoles.set(ROLES.WEREWOLF, 2);
        game.selectedRoles.set(ROLES.VILLAGER, 4);
        
        for (let i = 0; i < 6; i++) {
            game.addPlayer({ id: `user${i}`, username: `User${i}` });
        }
        
        await game.startGame();

        // Try to vote without nomination
        await expect(game.submitVote('someId', true))
            .rejects.toThrow('Wrong phase');
    });
});












