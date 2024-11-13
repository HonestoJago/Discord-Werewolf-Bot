const WerewolfGame = require('../../game/WerewolfGame');
const NightActionProcessor = require('../../game/NightActionProcessor');
const { createMockClient, createMockInteraction } = require('../helpers/discordMocks');
const ROLES = require('../../constants/roles');
const PHASES = require('../../constants/phases');

describe('Seer Investigation Tests', () => {
    let game;
    let mockClient;
    let mockChannel;
    let seer;
    let werewolf;
    let villager;
    let dmSpy;
    let broadcastSpy;

    beforeEach(() => {
        // Create mock channel with all necessary Discord.js methods
        mockChannel = {
            send: jest.fn().mockResolvedValue({}),
            awaitMessages: jest.fn().mockResolvedValue(new Map()),
            permissionOverwrites: {
                create: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({})
            }
        };

        // Create mock client with all necessary Discord.js methods
        mockClient = createMockClient({
            channels: {
                fetch: jest.fn().mockResolvedValue(mockChannel),
                create: jest.fn().mockResolvedValue(mockChannel)
            },
            users: {
                fetch: jest.fn().mockImplementation((userId) => Promise.resolve({
                    id: userId,
                    username: `User_${userId}`,
                    createDM: jest.fn().mockResolvedValue(mockChannel)
                }))
            }
        });

        // Create game instance
        game = new WerewolfGame(mockClient, 'testGuild', 'testChannel', 'creatorId');
        
        // Create test players with full Discord.js-like implementations
        seer = {
            id: 'seer123',
            username: 'TestSeer',
            role: ROLES.SEER,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true),
            channel: mockChannel,
            client: mockClient
        };
        
        werewolf = {
            id: 'wolf123',
            username: 'TestWerewolf',
            role: ROLES.WEREWOLF,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true),
            channel: mockChannel,
            client: mockClient
        };
        
        villager = {
            id: 'villager123',
            username: 'TestVillager',
            role: ROLES.VILLAGER,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true),
            channel: mockChannel,
            client: mockClient
        };

        // Add players to game
        game.players.set(seer.id, seer);
        game.players.set(werewolf.id, werewolf);
        game.players.set(villager.id, villager);

        // Set up game state
        game.phase = PHASES.NIGHT;
        game.round = 1;
        game.expectedNightActions = new Set([seer.id]);
        game.nightActionProcessor = new NightActionProcessor(game);
        
        // Mock game methods that interact with Discord
        game.broadcastMessage = jest.fn().mockResolvedValue(true);
        game.advanceToDay = jest.fn().mockResolvedValue(true);
        
        // Set up spies
        dmSpy = jest.spyOn(seer, 'sendDM');
        broadcastSpy = jest.spyOn(game, 'broadcastMessage');
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('Seer receives correct investigation result for Werewolf', async () => {
        // Set up night action
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        // Process night actions
        await game.nightActionProcessor.processNightActions();

        // Verify DM was sent with correct werewolf result
        expect(dmSpy).toHaveBeenCalledWith(expect.objectContaining({
            embeds: [expect.objectContaining({
                color: 0x4B0082,
                title: '🔮 Vision Revealed',
                description: expect.stringContaining('a Werewolf!'),
                footer: { text: 'Use this knowledge wisely...' }
            })]
        }));

        // Verify the message was sent exactly once
        expect(dmSpy).toHaveBeenCalledTimes(1);
    });

    test('Seer receives correct investigation result for Villager', async () => {
        // Set up night action
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: villager.id
        };
        game.completedNightActions.add(seer.id);

        // Process night actions
        await game.nightActionProcessor.processNightActions();

        // Verify DM was sent with correct non-werewolf result
        expect(dmSpy).toHaveBeenCalledWith(expect.objectContaining({
            embeds: [expect.objectContaining({
                color: 0x4B0082,
                title: '🔮 Vision Revealed',
                description: expect.stringContaining('Not a Werewolf'),
                footer: { text: 'Use this knowledge wisely...' }
            })]
        }));

        // Verify the message was sent exactly once
        expect(dmSpy).toHaveBeenCalledTimes(1);
    });

    test('Seer investigation is processed only once per night', async () => {
        // Set up night action
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        // Process night actions twice
        await game.nightActionProcessor.processNightActions();
        await game.nightActionProcessor.processNightActions();

        // Verify DM was sent exactly once
        expect(dmSpy).toHaveBeenCalledTimes(1);

        // Verify the investigationProcessed flag was set
        expect(game.nightActionProcessor.investigationProcessed).toBe(true);
    });

    test('Seer investigation handles invalid target gracefully', async () => {
        // Set up night action with invalid target
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: 'nonexistentId'
        };
        game.completedNightActions.add(seer.id);

        // Process night actions
        await game.nightActionProcessor.processNightActions();

        // Verify no DM was sent for invalid target
        expect(dmSpy).not.toHaveBeenCalled();
    });

    test('Seer investigation advances to day phase after completion', async () => {
        // Mock the advanceToDay method
        game.advanceToDay = jest.fn().mockResolvedValue(true);

        // Set up night action
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        // Process night actions
        await game.nightActionProcessor.processNightActions();

        // Verify phase advancement
        expect(game.advanceToDay).toHaveBeenCalled();
    });

    test('Seer investigation fails if target is dead', async () => {
        // Set target as dead
        villager.isAlive = false;
        
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: villager.id
        };
        game.completedNightActions.add(seer.id);

        await game.nightActionProcessor.processNightActions();

        expect(dmSpy).not.toHaveBeenCalled();
    });

    test('Seer cannot investigate if dead', async () => {
        seer.isAlive = false;
        
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        await game.nightActionProcessor.processNightActions();

        expect(dmSpy).not.toHaveBeenCalled();
    });

    test('Seer investigation handles DM errors gracefully', async () => {
        // Mock DM to throw error
        seer.sendDM.mockRejectedValueOnce(new Error('DM Failed'));
        
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        await game.nightActionProcessor.processNightActions();

        // Should still advance to day despite DM error
        expect(game.advanceToDay).toHaveBeenCalled();
    });

    test('Seer investigation processes with multiple night actions', async () => {
        // Add bodyguard to game
        const bodyguard = {
            id: 'bodyguard123',
            username: 'TestBodyguard',
            role: ROLES.BODYGUARD,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true)
        };
        game.players.set(bodyguard.id, bodyguard);
        
        // Set up multiple night actions
        game.nightActions = {
            [seer.id]: { action: 'investigate', target: werewolf.id },
            [bodyguard.id]: { action: 'protect', target: villager.id }
        };
        game.completedNightActions.add(seer.id);
        game.completedNightActions.add(bodyguard.id);

        await game.nightActionProcessor.processNightActions();

        // Verify Seer got their result
        expect(dmSpy).toHaveBeenCalledWith(expect.objectContaining({
            embeds: [expect.objectContaining({
                description: expect.stringContaining('a Werewolf!')
            })]
        }));
    });

    test('Seer investigation processes in correct order', async () => {
        const executionOrder = [];
        
        // Store original methods
        const originalInvestigation = game.nightActionProcessor.processSeerInvestigation;
        const originalProtection = game.nightActionProcessor.processBodyguardProtection;
        const originalAttacks = game.nightActionProcessor.processWerewolfAttacks;
        
        // Mock methods to track execution order
        game.nightActionProcessor.processSeerInvestigation = jest.fn().mockImplementation(async () => {
            executionOrder.push('investigation');
            await originalInvestigation.call(game.nightActionProcessor);
        });
        
        game.nightActionProcessor.processBodyguardProtection = jest.fn().mockImplementation(async () => {
            executionOrder.push('protection');
            await originalProtection.call(game.nightActionProcessor);
        });
        
        game.nightActionProcessor.processWerewolfAttacks = jest.fn().mockImplementation(async () => {
            executionOrder.push('attacks');
            await originalAttacks.call(game.nightActionProcessor);
        });

        // Set up and process night action
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        await game.nightActionProcessor.processNightActions();

        // Verify correct order
        expect(executionOrder).toEqual(['investigation', 'protection', 'attacks']);

        // Restore original methods
        game.nightActionProcessor.processSeerInvestigation = originalInvestigation;
        game.nightActionProcessor.processBodyguardProtection = originalProtection;
        game.nightActionProcessor.processWerewolfAttacks = originalAttacks;
    });

    test('Seer investigation properly formats Discord embed', async () => {
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        await game.nightActionProcessor.processNightActions();

        // Verify exact Discord embed structure
        expect(dmSpy).toHaveBeenCalledWith({
            embeds: [{
                color: 0x4B0082,
                title: '🔮 Vision Revealed',
                description: expect.stringContaining('a Werewolf!'),
                footer: { text: 'Use this knowledge wisely...' }
            }]
        });
    });

    test('Seer investigation handles Discord API errors', async () => {
        // Mock Discord API error
        mockChannel.send.mockRejectedValueOnce(new Error('Discord API Error'));
        
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        await game.nightActionProcessor.processNightActions();

        // Should still advance to day despite Discord API error
        expect(game.advanceToDay).toHaveBeenCalled();
    });

    test('Seer investigation properly cleans up after completion', async () => {
        game.nightActions[seer.id] = {
            action: 'investigate',
            target: werewolf.id
        };
        game.completedNightActions.add(seer.id);

        await game.nightActionProcessor.processNightActions();

        // Verify state cleanup
        expect(game.nightActions).toEqual({});
        expect(game.completedNightActions.size).toBe(0);
        expect(game.expectedNightActions.size).toBe(0);
    });
}); 