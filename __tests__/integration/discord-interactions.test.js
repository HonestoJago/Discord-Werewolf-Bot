const WerewolfGame = require('../../game/WerewolfGame');
const Player = require('../../game/Player');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');
const dayPhaseHandler = require('../../handlers/dayPhaseHandler');

describe('Discord.js Integration', () => {
    let game;
    let mockClient;
    let mockChannel;
    let mockMessage;

    beforeEach(() => {
        // Enable fake timers
        jest.useFakeTimers();

        // Mock message for updates
        mockMessage = {
            id: 'message123',
            edit: jest.fn().mockResolvedValue({}),
            components: [],
            embeds: []
        };

        // Mock channel for sending messages
        mockChannel = {
            send: jest.fn().mockResolvedValue(mockMessage),
            messages: {
                fetch: jest.fn().mockResolvedValue(mockMessage)
            }
        };

        // Mock Discord client
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

    afterEach(() => {
        // Clean up timers
        jest.useRealTimers();
        if (game) {
            game.cleanup();
        }
    });

    describe('Day Phase GUI', () => {
        test('creates and updates day phase interface', async () => {
            // Setup players
            const player1 = new Player('p1', 'Player1', mockClient);
            const player2 = new Player('p2', 'Player2', mockClient);
            [player1, player2].forEach(p => {
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            // Start day phase
            game.phase = PHASES.DAY;
            await game.advanceToDay();

            // Verify message was sent
            expect(mockChannel.send).toHaveBeenCalled();
            const call = mockChannel.send.mock.calls[0][0];
            expect(call.embeds[0].title).toBe('Day Phase');
            expect(call.components).toBeDefined();
        });

        test('handles nomination button click', async () => {
            // Setup mock interaction
            const interaction = {
                customId: 'day_nominate',
                user: { id: 'p1' },
                reply: jest.fn().mockResolvedValue({}),
                update: jest.fn().mockResolvedValue({})
            };

            // Setup game state
            const player = new Player('p1', 'Player1', mockClient);
            player.isAlive = true;
            game.players.set(player.id, player);
            game.phase = PHASES.DAY;

            // Mock the dayPhaseHandler methods
            jest.spyOn(dayPhaseHandler, 'handleButton').mockImplementation(async () => {
                await interaction.reply({
                    components: [{ type: 'SELECT_MENU' }],
                    ephemeral: true
                });
            });

            await dayPhaseHandler.handleButton(interaction, game);
            expect(interaction.reply).toHaveBeenCalled();
        });
    });

    describe('Voting Interface', () => {
        test('updates interface through voting workflow', async () => {
            // Setup players
            const nominator = new Player('nom', 'Nominator', mockClient);
            const target = new Player('target', 'Target', mockClient);
            const seconder = new Player('sec', 'Seconder', mockClient);

            [nominator, target, seconder].forEach(p => {
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            // Set correct phase
            game.phase = PHASES.DAY;

            // Mock the broadcast message method
            game.broadcastMessage = jest.fn().mockResolvedValue({});

            // Start nomination
            await game.nominate(nominator.id, target.id);
            expect(game.phase).toBe(PHASES.NOMINATION);
            expect(game.nominatedPlayer).toBe(target.id);

            // Process second with valid seconder
            await game.second(seconder.id);
            expect(game.phase).toBe(PHASES.VOTING);
            expect(game.votingOpen).toBe(true);

            // Verify broadcast messages were sent
            expect(game.broadcastMessage).toHaveBeenCalledTimes(2);
            const secondCall = game.broadcastMessage.mock.calls[1][0];
            expect(secondCall.embeds[0].title).toBe('Voting Started');
        });

        test('handles failed nomination', async () => {
            const nominator = new Player('nom', 'Nominator', mockClient);
            const target = new Player('target', 'Target', mockClient);

            [nominator, target].forEach(p => {
                p.isAlive = true;
                game.players.set(p.id, p);
            });

            game.phase = PHASES.DAY;

            // Mock the broadcast message method
            game.broadcastMessage = jest.fn().mockResolvedValue({});

            // Start nomination
            await game.nominate(nominator.id, target.id);
            expect(game.phase).toBe(PHASES.NOMINATION);

            // Wait for nomination timeout
            jest.advanceTimersByTime(game.NOMINATION_WAIT_TIME + 100);
            await Promise.resolve(); // Let promises resolve

            // Verify nomination failed message was broadcast
            expect(game.broadcastMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: [expect.objectContaining({
                        title: 'Nomination Failed'
                    })]
                })
            );
            expect(game.phase).toBe(PHASES.DAY);
        });
    });
});
